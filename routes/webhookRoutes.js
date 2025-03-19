

// routes/webhookRoutes.js - Route handlers for webhook endpoints
const express = require('express');
const router = express.Router();
const { parseProxyCommand, standardizePhoneNumber } = require('../utils/messageUtils');
const { sendWhatsAppMessage } = require('../services/messageService');
const userService = require('../services/userService');
const medicationService = require('../services/medicationService');
const proxyService = require('../services/proxyService');
const aiResponseService = require('../services/aiResponseService');
const medicationInfoService = require('../services/medicationInfoService');
const { UserModel,ReminderModel, SymptomModel, DB_TABLES } = require('../models/dbModels');
const sessionStore = require('../models/sessionStore');
const checkInService = require('../services/checkInService');
const conversationUtils = require('../utils/conversationUtils');
const { dynamoDB } = require('../config/config');

// Import handlers
const accountHandler = require('../handlers/accountHandler');
const medicationHandler = require('../handlers/medicationHandler');
const symptomHandler = require('../handlers/symptomHandler');
const followUpHandler = require('../handlers/followUpHandler');
const menuHandler = require('../handlers/menuHandler');

/**
 * Main webhook endpoint handler with prioritized processing logic
 */
router.post('/', async (req, res) => {
    try {
        const incomingMsg = req.body.Body.trim();
        const incomingMsgLower = incomingMsg.toLowerCase();
        const from = req.body.From;
        const profileName = req.body.ProfileName || "User";

        console.log(`📩 Incoming message from ${from}: ${incomingMsg}`);
        const standardizedFrom = standardizePhoneNumber(from);

        // Track interaction timestamp whenever user sends a message
        try {
            await UserModel.updateLastInteraction(standardizedFrom);
        } catch (interactionError) {
            console.error(`Error tracking interaction: ${interactionError}`);
            // Continue processing even if tracking fails
        }

        //======================================================================
        // PART 0: HANDLE ONGOING DISAMBIGUATION FIRST
        //======================================================================
        
        // Get the current session state
        let userSession = sessionStore.getUserSession(from) || sessionStore.getUserSession(standardizedFrom);
        
        // Handle ongoing disambiguation session first
        if (userSession && userSession.type === 'disambiguation') {
            console.log(`Processing disambiguation response: stage=${userSession.stage}, response=${incomingMsg}`);
            
            // Handle specific disambiguation for medication vs check-in
            if (userSession.stage === 'reminder_vs_checkin') {
                if (incomingMsg === "1") {
                    // User is responding to medication reminder
                    console.log(`User clarified they are responding to medication reminder`);
                    
                    // Restore the original response and clear the disambiguation
                    const originalResponse = userSession.originalResponse;
                    const reminderData = userSession.reminderData;
                    
                    // Clear the disambiguation session
                    sessionStore.deleteUserSession(from);
                    sessionStore.deleteUserSession(standardizedFrom);
                    
                    // Clear any check-in session to avoid future conflicts
                    checkInService.clearActiveCheckInSession(standardizedFrom);
                    
                    // Process as medication response
                    try {
                        req.body.Body = originalResponse; // Replace with original response
                        
                        if (originalResponse.toLowerCase() === "yes" || originalResponse.toLowerCase() === "taken") {
                            return await medicationHandler.handleMedicationTaken(req, res);
                        } else {
                            return await medicationHandler.handleMedicationMissed(req, res);
                        }
                    } catch (error) {
                        console.error(`❌ Error handling medication response after disambiguation: ${error}`);
                        await sendWhatsAppMessage(from, "Sorry, there was an error processing your medication response. Please try again later.");
                        return res.status(200).send("Error handling medication response after disambiguation");
                    }
                } else if (incomingMsg === "2") {
                    // User is responding to check-in
                    console.log(`User clarified they are responding to check-in`);
                    
                    // Restore the original response
                    const originalResponse = userSession.originalResponse;
                    const checkInData = userSession.checkInData;
                    const reminderData = userSession.reminderData;
                    
                    // Clear the disambiguation session
                    sessionStore.deleteUserSession(from);
                    sessionStore.deleteUserSession(standardizedFrom);
                    
                    // Mark the reminder as skipped due to conflict
                    if (reminderData && reminderData.reminderId) {
                        await ReminderModel.markReminderSkipped(reminderData.reminderId, "User chose to respond to check-in instead");
                    }
                    
                    // Process the check-in response
                    const checkInResult = await checkInService.processCheckInResponse(standardizedFrom, originalResponse);
                    
                    if (checkInResult && checkInResult.success) {
                        await sendWhatsAppMessage(from, checkInResult.followUp);
                        
                        if (checkInResult.conversationComplete) {
                            // Remind about the skipped medication after check-in completes
                            setTimeout(async () => {
                                if (reminderData && reminderData.medicine) {
                                    await sendWhatsAppMessage(from, 
                                        `Don't forget to take your ${reminderData.medicine}! Please respond with "Yes" when you've taken it or "No" if you need a reminder later.`
                                    );
                                }
                                
                                // Show main menu afterward
                                setTimeout(async () => {
                                    await menuHandler.sendMainMenu(from);
                                }, 3000);
                            }, 2000);
                        }
                        
                        return res.status(200).send("Check-in response processed after disambiguation");
                    } else {
                        // If check-in processing failed, show the main menu
                        setTimeout(async () => {
                            await menuHandler.sendMainMenu(from);
                        }, 2000);
                        
                        return res.status(200).send("Failed to process check-in after disambiguation");
                    }
                } else {
                    // Invalid choice
                    await sendWhatsAppMessage(from, 
                        `Please reply with either 1 for medication reminder or 2 for check-in conversation.`
                    );
                    return res.status(200).send("Invalid disambiguation choice");
                }
            }
            // Handle general disambiguation using the conversation utilities
            else if (userSession.stage === 'general') {
                try {
                    // Get the selected conversation option
                    const optionIndex = parseInt(incomingMsg) - 1;
                    
                    if (isNaN(optionIndex) || optionIndex < 0 || optionIndex >= userSession.options.length) {
                        // Invalid option selected
                        await sendWhatsAppMessage(from, `Please select a valid option between 1 and ${userSession.options.length}.`);
                        return res.status(200).send("Invalid disambiguation option");
                    }
                    
                    const selectedOption = userSession.options[optionIndex];
                    const originalResponse = userSession.originalResponse;
                    
                    console.log(`User selected conversation: ${selectedOption.type} (${selectedOption.description})`);
                    
                    // Clear the disambiguation session
                    sessionStore.deleteUserSession(from);
                    sessionStore.deleteUserSession(standardizedFrom);
                    
                    // Process based on the selected conversation type
                    if (selectedOption.type === 'medication_reminder') {
                        // Restore medication reminder flow
                        req.body.Body = originalResponse;
                        
                        if (originalResponse.toLowerCase() === "yes" || originalResponse.toLowerCase() === "taken") {
                            return await medicationHandler.handleMedicationTaken(req, res);
                        } else {
                            return await medicationHandler.handleMedicationMissed(req, res);
                        }
                    }
                    else if (selectedOption.type === 'check_in_response') {
                        // Process as check-in response
                        const checkInResult = await checkInService.processCheckInResponse(standardizedFrom, originalResponse);
                        
                        if (checkInResult && checkInResult.success) {
                            await sendWhatsAppMessage(from, checkInResult.followUp);
                            
                            if (checkInResult.conversationComplete) {
                                setTimeout(async () => {
                                    await menuHandler.sendMainMenu(from);
                                }, 2000);
                            }
                            
                            return res.status(200).send("Check-in response processed after disambiguation");
                        }
                    }
                    else if (selectedOption.type === 'symptom_assessment') {
                        // Restore symptom assessment flow
                        req.body.Body = originalResponse;
                        return await symptomHandler.continueSymptomAssessment(req, res);
                    }
                    else if (selectedOption.type === 'menu_navigation') {
                        // Restore menu navigation
                        req.body.Body = originalResponse;
                        if (selectedOption.data.stage === 'main_menu') {
                            return await menuHandler.handleMainMenuSelection(req, res);
                        } else {
                            return await menuHandler.handleMedicationMenuSelection(req, res);
                        }
                    }
                    else if (selectedOption.type === 'medication_management') {
                        // Restore medication management flow based on stage
                        req.body.Body = originalResponse;
                        
                        // Determine which medication handler to use based on the stage
                        const stage = selectedOption.data.stage;
                        
                        if (stage === 1 || stage === 2 || stage.toString().startsWith('add_')) {
                            return await medicationHandler.continueAddMedication(req, res);
                        }
                        else if (stage.toString().startsWith('update_')) {
                            return await medicationHandler.continueMedicationUpdate(req, res);
                        }
                        else if (stage.toString().startsWith('delete_')) {
                            return await medicationHandler.continueMedicationDeletion(req, res);
                        }
                    }
                    
                    // If we get here, we couldn't specifically handle the selected option
                    await sendWhatsAppMessage(from, "I'm not sure how to process your response. Let's start fresh.");
                    await menuHandler.sendMainMenu(from);
                    return res.status(200).send("Disambiguation fallback");
                    
                } catch (error) {
                    console.error(`❌ Error handling general disambiguation: ${error}`);
                    
                    // Clear session and go to main menu as fallback
                    sessionStore.deleteUserSession(from);
                    sessionStore.deleteUserSession(standardizedFrom);
                    
                    await sendWhatsAppMessage(from, "I'm sorry, I had trouble understanding your response. Let's start over.");
                    await menuHandler.sendMainMenu(from);
                    return res.status(200).send("Disambiguation error fallback");
                }
            }
        }

        //======================================================================
        // PART 1: DETECT & HANDLE CONVERSATION CONFLICTS
        //======================================================================
        
        // Get active check-in session for conflict detection
        const activeCheckIn = checkInService.getActiveCheckInSession(standardizedFrom);
        
        // Use conversationUtils to detect potential conflicts
        const conflictInfo = await conversationUtils.detectConversationConflicts(
            standardizedFrom,
            sessionStore,
            { [standardizedFrom]: activeCheckIn },  // Map active check-in sessions
            ReminderModel.getLatestReminder
        );
        
        // If we have multiple active conversations, manage the potential conflict
        if (conflictInfo.hasConflict) {
            console.log(`⚠️ Detected conversation conflict: ${conflictInfo.activeConversations.length} active conversations`);
            conflictInfo.activeConversations.forEach((conv, index) => {
                console.log(`  ${index + 1}. ${conv.type}: ${conv.description}`);
            });
            
            // Check if the current message helps disambiguate the intent
            const disambiguationResult = conversationUtils.handleDisambiguation(
                incomingMsg, 
                conflictInfo
            );
            
            // If we can automatically determine which conversation without asking, proceed
            if (!disambiguationResult.needsDisambiguation) {
                console.log(`🔄 Proceeding with conversation: ${disambiguationResult.targetConversation.type}`);
                
                // Nothing to do here - we'll continue with normal processing
                // The priority system ensures medication reminders are checked first
            } 
            // Otherwise, ask the user to disambiguate their intent
            else {
                console.log(`❓ Asking user to disambiguate their intent (type: ${disambiguationResult.conflictType})`);
                
                // Generate appropriate disambiguation message
                const message = conversationUtils.generateDisambiguationMessage(
                    disambiguationResult
                );
                
                // Save the disambiguation state in the session
                sessionStore.setUserSession(from, {
                    type: 'disambiguation',
                    stage: 'general',
                    options: disambiguationResult.options,
                    originalResponse: incomingMsg,
                    timestamp: Date.now()
                });
                
                // Also save with standardized phone if different
                if (standardizedFrom !== from) {
                    sessionStore.setUserSession(standardizedFrom, {
                        type: 'disambiguation',
                        stage: 'general',
                        options: disambiguationResult.options,
                        originalResponse: incomingMsg,
                        timestamp: Date.now()
                    });
                }
                
                // Send disambiguation message
                await sendWhatsAppMessage(from, message);
                return res.status(200).send("Asked for disambiguation between multiple conversations");
            }
        }

        //======================================================================
        // PART 2: HANDLE MEDICATION REMINDERS WITH IMPROVED DETECTION
        //======================================================================

        // More robust check for medication responses
        if (incomingMsgLower === "yes" || incomingMsgLower === "no" || 
            incomingMsgLower === "taken" || incomingMsgLower === "missed") {
            
            console.log(`Checking medication reminders for: ${standardizedFrom}`);
            // Extend window to 60 minutes to be more lenient with reminder responses
            const sixtyMinutesAgo = new Date(new Date().getTime() - 60 * 60 * 1000);
            console.log(`Looking for reminders since: ${sixtyMinutesAgo.toISOString()}`);
            
            // Get the latest reminder from database
            const latestReminder = await ReminderModel.getLatestReminder(standardizedFrom);
            console.log(`Latest reminder check result:`, latestReminder);
            
            // If there's a recent unresponded reminder
            if (latestReminder && !latestReminder.responded) {
                console.log(`Found active reminder for ${standardizedFrom}, treating "${incomingMsg}" as medication response`);
                
                // If there's also an active check-in, we already handled the conflict detection above
                // with conversationUtils, but we keep this check as a backup
                if (activeCheckIn && activeCheckIn.conversationState !== 'completed' && 
                    !conflictInfo.hasConflict) { // Only if not already handled by conflict detection
                        
                    console.log(`❗ Found both active reminder AND active check-in - disambiguation needed`);
                    
                    // Set up a disambiguation session
                    sessionStore.setUserSession(from, {
                        type: 'disambiguation',
                        stage: 'reminder_vs_checkin',
                        reminderData: latestReminder,
                        checkInData: activeCheckIn,
                        originalResponse: incomingMsg,
                        timestamp: Date.now()
                    });
                    
                    // Also with standardized phone if different
                    if (standardizedFrom !== from) {
                        sessionStore.setUserSession(standardizedFrom, {
                            type: 'disambiguation',
                            stage: 'reminder_vs_checkin',
                            reminderData: latestReminder,
                            checkInData: activeCheckIn,
                            originalResponse: incomingMsg,
                            timestamp: Date.now()
                        });
                    }
                    
                    await sendWhatsAppMessage(from, 
                        `I noticed you have both a medication reminder and an active check-in conversation. Which one are you responding to?\n\n` +
                        `1️⃣ Medication reminder (${latestReminder.medicine})\n` +
                        `2️⃣ Check-in conversation\n\n` +
                        `Please reply with 1 or 2.`
                    );
                    
                    return res.status(200).send("Asked for disambiguation between reminder and check-in");
                }
                
                // No conflict, proceed with medication response
                try {
                    // Clear any potentially conflicting sessions
                    sessionStore.deleteUserSession(from);
                    sessionStore.deleteUserSession(standardizedFrom);
                    
                    if (incomingMsgLower === "yes" || incomingMsgLower === "taken") {
                        return await medicationHandler.handleMedicationTaken(req, res);
                    } else {
                        return await medicationHandler.handleMedicationMissed(req, res);
                    }
                } catch (error) {
                    console.error(`❌ Error handling medication response: ${error}`);
                    await sendWhatsAppMessage(from, "Sorry, there was an error processing your medication response. Please try again later.");
                    return res.status(200).send("Error handling medication response");
                }
            }
            console.log(`No active medication reminder found for ${standardizedFrom}, continuing with regular processing`);
        }

        // Refresh user session after potential changes
        userSession = sessionStore.getUserSession(from) || sessionStore.getUserSession(standardizedFrom);
        const medicationSession = sessionStore.getMedicationSession(from) || sessionStore.getMedicationSession(standardizedFrom);
        
        // Log the current session state for debugging
        console.log(`Current user session: ${userSession ? JSON.stringify(userSession) : 'None'}`);
        console.log(`Current medication session: ${medicationSession ? JSON.stringify(medicationSession) : 'None'}`);

        //======================================================================
        // PART 3: HANDLE ACTIVE SESSIONS AND ONGOING CONVERSATIONS
        //======================================================================
        
        // Continue account creation flow if in progress
        if (sessionStore.getAccountCreationSession(from) || sessionStore.getAccountCreationSession(standardizedFrom)) {
            return await accountHandler.continueAccountCreation(req, res);
        }

        // Continue medication add flow - Check first for active medication flows
        if (medicationSession && medicationSession.stage && 
            (medicationSession.stage === 1 || 
             medicationSession.stage === 2 || 
             medicationSession.stage.toString().startsWith('add_'))) {
            return await medicationHandler.continueAddMedication(req, res);
        }
        
        // Continue medication update flow
        if (medicationSession && medicationSession.stage && 
            medicationSession.stage.toString().startsWith('update_')) {
            return await medicationHandler.continueMedicationUpdate(req, res);
        }
        
        // Continue medication deletion flow
        if (medicationSession && medicationSession.stage && 
            medicationSession.stage.toString().startsWith('delete_')) {
            return await medicationHandler.continueMedicationDeletion(req, res);
        }
        
        // Handle symptom assessment flow
        if (userSession && userSession.type === 'symptom') {
            return await symptomHandler.continueSymptomAssessment(req, res);
        }
        
        // Handle symptom follow-up responses
        if (userSession && userSession.type === 'follow_up') {
            console.log(`Found follow-up session for ${from}, handling follow-up response`);
            return await followUpHandler.handleFollowUpResponse(req, res);
        }

        // Handle main menu selection - Only process numeric selection if in main menu
        if (userSession && userSession.stage === 'main_menu') {
            return await menuHandler.handleMainMenuSelection(req, res);
        }

        // Handle medication menu selection
        if (userSession && userSession.stage === 'medication_menu') {
            return await menuHandler.handleMedicationMenuSelection(req, res);
        }

        // Handle medication info selection
        if (userSession && userSession.stage === 'medication_info_selection') {
            return await medicationHandler.handleMedicationInfoSelection(req, res);
        }

        //======================================================================
        // PART 4: HANDLE CHECK-IN RESPONSES
        //======================================================================
        
        // Check if this might be a response to a check-in
        if (!userSession && !medicationSession) {
            try {
                const checkInResult = await checkInService.processCheckInResponse(standardizedFrom, incomingMsg);
                
                if (checkInResult && checkInResult.success) {
                    console.log(`✅ Successfully processed check-in response`);
                    
                    // Send the follow-up message
                    await sendWhatsAppMessage(from, checkInResult.followUp);
                    
                    // If the conversation isn't complete, don't send the main menu
                    if (!checkInResult.conversationComplete) {
                        return res.status(200).send("Check-in follow-up sent");
                    }
                    
                    // Only return to the main menu if the conversation is complete
                    if (checkInResult.conversationComplete) {
                        setTimeout(async () => {
                            await menuHandler.sendMainMenu(from);
                        }, 5000); // Longer delay to let them read the final message
                    }
                    
                    return res.status(200).send("Check-in response processed");
                }
            } catch (error) {
                console.error(`❌ Error processing check-in response: ${error}`);
                // Continue with other handlers if check-in processing fails
            }
        }

        //======================================================================
        // PART 5: HANDLE SYMPTOM FOLLOW-UPS FOR DIRECT NUMERIC RESPONSES
        //======================================================================

        // Handle numeric symptom follow-up responses (1, 2, 3, 4) ONLY if not in an active session
        if ((incomingMsg === "1" || incomingMsg === "2" || incomingMsg === "3" || incomingMsg === "4") && 
            (!userSession || (!userSession.stage && !userSession.type))) {
            
            console.log(`📱 Detected possible direct symptom follow-up response: ${incomingMsg}`);
            
            try {
                // Check for any active symptom assessments
                const activeAssessments = await SymptomModel.getActiveAssessments(standardizedFrom);
                console.log(`📱 Found ${activeAssessments.length} active assessments`);
                
                if (activeAssessments.length > 0) {
                    // Use the most recent assessment
                    const assessment = activeAssessments[0];
                    const assessmentId = assessment.assessmentId;
                    console.log(`📱 Processing direct follow-up for assessment: ${assessmentId}`);
                    
                    // Process the follow-up
                    const followUpService = require('../services/followUpService');
                    const result = await followUpService.processFollowUpResponse(
                        standardizedFrom,
                        assessmentId,
                        incomingMsg
                    );
                    
                    if (result.success) {
                        console.log(`📱 Successfully processed direct follow-up response`);
                        
                        // Send the recommendations
                        await sendWhatsAppMessage(from, result.recommendations);
                        
                        // Handle completion or continuation
                        if (result.isCompleted) {
                            await sendWhatsAppMessage(from, "✅ Thank you for using Sukoon Saarthi symptom tracking. Your symptom follow-up is now complete.");
                        } else {
                            await sendWhatsAppMessage(from, "I'll check in with you again tomorrow. If your symptoms change significantly before then, please use the symptom assessment option from the main menu.");
                        }
                        
                        setTimeout(async () => {
                            await menuHandler.sendMainMenu(from);
                        }, 2000);
                        
                        return res.status(200).send("Direct follow-up response processed");
                    } else {
                        console.log(`❌ Error processing follow-up: ${result.message || "Unknown error"}`);
                    }
                } else {
                    console.log(`📱 No active assessments found, continuing with regular flow`);
                }
            } catch (error) {
                console.error(`❌ Error handling numeric follow-up response: ${error}`);
            }
        }

        //======================================================================
        // PART 6: HANDLE ACCOUNT MANAGEMENT
        //======================================================================

        // Check if user exists
        const userExists = await userService.checkUserExists(from);
        
        // Handle account creation command
        if (!userExists && (incomingMsgLower === "create an account" || incomingMsgLower === "create account")) {
            return await accountHandler.startAccountCreation(req, res);
        }

        // If user doesn't exist and isn't creating an account, prompt to create account
        if (!userExists) {
            await sendWhatsAppMessage(from, 
                `Welcome to Sukoon Saarthi! It seems you don't have an account yet.\n\n` +
                `To create an account, please reply with "create account".`
            );
            return res.status(200).send("Asked to create account");
        }

        //======================================================================
        // PART 7: HANDLE EXPLICIT COMMANDS AND NAVIGATIONAL INPUTS
        //======================================================================

        // Handle proxy commands (child managing parent's account)
        const proxyCommand = parseProxyCommand(incomingMsg);
        if (proxyCommand) {
            return await handleProxyCommand(req, res, proxyCommand);
        }
        
        // Welcome message command
        if (incomingMsgLower === "hi" || incomingMsgLower === "hello") {
            return await menuHandler.showWelcomeMenu(req, res);
        }
        
        // Menu navigation commands
        if (incomingMsgLower === "menu" || incomingMsgLower === "main menu" || 
            incomingMsgLower === "back" || incomingMsgLower === "7") {
            await menuHandler.sendMainMenu(from);
            return res.status(200).send("Returned to main menu.");
        }
        
        //======================================================================
        // PART 8: HANDLE FEATURE-SPECIFIC COMMANDS
        //======================================================================
        
        // Symptom assessment commands
        if (incomingMsgLower === "symptom") {
            return await symptomHandler.startSymptomAssessment(req, res);
        }
        
        if (incomingMsgLower === "check symptom status" || incomingMsgLower === "symptom status") {
            return await followUpHandler.showSymptomStatus(req, res);
        }
        
        // Medication management commands
        if (incomingMsgLower === "add medicine") {
            return await medicationHandler.startAddMedication(req, res);
        }
        
        if (incomingMsgLower === "update medicine") {
            return await medicationHandler.startMedicationUpdate(req, res);
        }
        
        if (incomingMsgLower === "delete medicine" || incomingMsgLower === "remove medicine") {
            return await medicationHandler.startMedicationDeletion(req, res);
        }
        
        // Medication history commands
        if (incomingMsgLower === "show medication history last week") {
            return await medicationHandler.showMedicationHistory(req, res, 7);
        } else if (incomingMsgLower === "show all medication history") {
            return await medicationHandler.showMedicationHistory(req, res, null);
        }
        
        // Medication information request
        if (incomingMsgLower.includes('medicine info') || 
            incomingMsgLower.includes('medication info') || 
            incomingMsgLower.includes('drug info') ||
            incomingMsgLower.includes('about my medicine') ||
            incomingMsgLower.includes('tell me about') ||
            incomingMsgLower.startsWith('what is')) {
            
            // Get the user's medications first
            const medications = await medicationService.getUserMedications(from);
            
            // Process the medication info request
            const medicationInfo = await medicationInfoService.processMedicationInfoRequest(incomingMsg, medications);
            
            if (medicationInfo) {
                await sendWhatsAppMessage(from, medicationInfo);
                return res.status(200).send("Medication information sent.");
            }
            // If it wasn't a valid medication info request, fall through to AI response
        }
        
        // Check-in report request from caregiver
        if (incomingMsgLower.includes('daily report') || 
            incomingMsgLower.includes('check-in report') || 
            incomingMsgLower.includes('activity report') ||
            incomingMsgLower.includes('how is my parent') ||
            incomingMsgLower.includes('how is my mom') ||
            incomingMsgLower.includes('how is my dad')) {
            
            try {
                // Check if the user is a caregiver
                const userDetails = await userService.getUserDetails(standardizedFrom);
                
                if (userDetails && userDetails.userType === 'child') {
                    // Get the parent relationships
                    const relationships = await userService.getChildRelationships(standardizedFrom);
                    
                    if (relationships && relationships.length > 0) {
                        // Get the first parent by default
                        const parentPhone = relationships[0].parentPhone;
                        
                        // Generate the report
                        const report = await checkInService.generateDailyReport(parentPhone);
                        
                        await sendWhatsAppMessage(from, report);
                        return res.status(200).send("Daily report sent.");
                    }
                }
            } catch (error) {
                console.error(`❌ Error handling report request: ${error}`);
                // Continue to AI response if report generation fails
            }
        }
        
        //======================================================================
        // PART 9: HANDLE GENERIC QUERIES WITH AI
        //======================================================================

        // AI Response for any other query - this also handles casual conversation for check-ins
        console.log(`No specific handler matched, sending AI response`);
        const aiResponse = await aiResponseService.getAIResponse(incomingMsg);
        await sendWhatsAppMessage(from, aiResponse);
        return res.status(200).send("AI response sent.");

    } catch (error) {
        console.error("❌ Error processing webhook request:", error.message, error);
        try {
            // Try to send an error message to the user
            await sendWhatsAppMessage(req.body.From, 
                "I'm sorry, there was an error processing your request. Please try again later.");
        } catch (msgError) {
            console.error("❌ Error sending error message:", msgError);
        }
        return res.status(500).send("Internal Server Error");
    }
});

/**
 * Handle proxy commands
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} proxyCommand - Parsed proxy command
 */
async function handleProxyCommand(req, res, proxyCommand) {
    const from = req.body.From;
    const { parentPhone, command } = proxyCommand;
    
    console.log(`🔄 Proxy command detected from ${from} for ${parentPhone}: ${command}`);
    
    // Process the proxy command
    const result = await proxyService.processProxyMessage(from, parentPhone, command);
    
    await sendWhatsAppMessage(from, result.message);
    
// If needed, notify the parent
    if (result.success && result.notifyParent) {
        await proxyService.notifyParentOfProxyAction(
            parentPhone,
            from,
            result.action,
            result.detail
        );
    }
    
    return res.status(200).send("Proxy command processed");
}

/**
 * Check if there's a recent medication reminder
 * @param {string} userPhone - User's phone number
 * @returns {Promise<Object|null>} - Reminder data or null if none
 */
async function isRecentMedicationReminderSent(userPhone) {
    try {
        const thirtyMinutesAgo = new Date(new Date().getTime() - 30 * 60 * 1000);
        
        const params = {
            TableName: DB_TABLES.REMINDERS_TABLE,
            IndexName: "UserPhoneIndex",
            KeyConditionExpression: "userPhone = :phone",
            FilterExpression: "createdAt > :time",
            ExpressionAttributeValues: { 
                ":phone": userPhone,
                ":time": thirtyMinutesAgo.toISOString()
            },
            ScanIndexForward: false, // Get most recent first
            Limit: 1
        };
        
        const result = await dynamoDB.query(params).promise();
        return (result.Items && result.Items.length > 0) ? result.Items[0] : null;
    } catch (error) {
        console.error(`❌ Error checking recent medication reminders: ${error}`);
        return null;
    }
}

module.exports = router;