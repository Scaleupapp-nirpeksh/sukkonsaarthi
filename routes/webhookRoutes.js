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
const { ReminderModel, SymptomModel } = require('../models/dbModels');
const sessionStore = require('../models/sessionStore');
const checkInService = require('../services/checkInService');

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

        // Get the current session state early
        const standardizedFrom = standardizePhoneNumber(from);
        let userSession = sessionStore.getUserSession(from);
        
        // If session not found with original format, try standardized format
        if (!userSession) {
            userSession = sessionStore.getUserSession(standardizedFrom);
            console.log(`Looking for session with standardized phone: ${standardizedFrom}`);
        }
        
        const medicationSession = sessionStore.getMedicationSession(from);
        
        // Log the current session state for debugging
        console.log(`Current user session: ${userSession ? JSON.stringify(userSession) : 'None'}`);
        console.log(`Current medication session: ${medicationSession ? JSON.stringify(medicationSession) : 'None'}`);

        //======================================================================
        // PART 0: HANDLE MEDICATION REMINDERS FIRST (HIGHEST PRIORITY)
        //======================================================================

        // Handle "Yes/No" medication responses (regardless of user session)
        if (incomingMsgLower === "yes" || incomingMsgLower === "no") {
            console.log(`Checking for medication reminders for: ${standardizedFrom}`);
            const thirtyMinutesAgo = new Date(new Date().getTime() - 30 * 60 * 1000);
            console.log(`Looking for reminders since: ${thirtyMinutesAgo.toISOString()}`);
            
            // Get the latest reminder from database to see if this is a medication response
            const latestReminder = await ReminderModel.getLatestReminder(standardizedFrom);
            console.log(`Latest reminder check result:`, latestReminder);
            
            // If there's a recent unresponded reminder, treat this as a medication response
            if (latestReminder && !latestReminder.responded) {
                console.log(`Found active reminder for ${standardizedFrom}, treating "${incomingMsg}" as medication response`);
                
                try {
                    if (incomingMsgLower === "yes") {
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
            console.log(`No active reminder found for ${standardizedFrom}, treating "${incomingMsg}" as regular message`);
        }

        //======================================================================
        // PART 1: HANDLE ACTIVE SESSIONS AND ONGOING CONVERSATIONS
        //======================================================================
        
        // Continue account creation flow if in progress
        if (sessionStore.getAccountCreationSession(from)) {
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
        // PART 2: HANDLE CHECK-IN RESPONSES
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
        // PART 3: HANDLE SYMPTOM FOLLOW-UPS FOR DIRECT NUMERIC RESPONSES
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
        // PART 4: HANDLE ACCOUNT MANAGEMENT
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
        // PART 5: HANDLE EXPLICIT COMMANDS AND NAVIGATIONAL INPUTS
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
        // PART 6: HANDLE FEATURE-SPECIFIC COMMANDS
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
        // PART 7: HANDLE GENERIC QUERIES WITH AI
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

module.exports = router;