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
const symptomAssessmentService = require('../services/symptomAssessmentService');
const followUpService = require('../services/followUpService');
const { ReminderModel, SymptomModel } = require('../models/dbModels');
const sessionStore = require('../models/sessionStore');

// Import handlers
const accountHandler = require('../handlers/accountHandler');
const medicationHandler = require('../handlers/medicationHandler');
const symptomHandler = require('../handlers/symptomHandler');
const followUpHandler = require('../handlers/followUpHandler');
const menuHandler = require('../handlers/menuHandler');

/**
 * Main webhook endpoint handler
 */
router.post('/', async (req, res) => {
    try {
        const incomingMsg = req.body.Body.trim();
        const incomingMsgLower = incomingMsg.toLowerCase();
        const from = req.body.From;
        const profileName = req.body.ProfileName || "User";

        console.log(`📩 Incoming message from ${from}: ${incomingMsg}`);

        // PRIORITY 1: Handle medication confirmation responses FIRST
        // This ensures medication responses are caught before any other logic
        if (incomingMsgLower === "yes" || incomingMsgLower === "no") {
            const standardizedFrom = standardizePhoneNumber(from); 
            // Get the latest reminder from database to see if this is a medication response
            const latestReminder = await ReminderModel.getLatestReminder(standardizedFrom);
            
            // If there's a recent unresponded reminder, treat this as a medication response
            if (latestReminder && !latestReminder.responded) {
                console.log(`Found active reminder for ${from}, treating "${incomingMsg}" as medication response`);
                
                if (incomingMsgLower === "yes") {
                    return await medicationHandler.handleMedicationTaken(req, res);
                } else {
                    return await medicationHandler.handleMedicationMissed(req, res);
                }
            }
            // If no active reminder, continue with regular message processing
            console.log(`No active reminder found for ${from}, treating "${incomingMsg}" as regular message`);
        }

        // PRIORITY 1.5: Handle numeric symptom follow-up responses (1, 2, 3, 4)
        if (incomingMsg === "1" || incomingMsg === "2" || incomingMsg === "3" || incomingMsg === "4") {
            console.log(`📱 Detected possible symptom follow-up response: ${incomingMsg}`);
            
            // Try to find active symptom assessments for this user
            const standardizedFrom = standardizePhoneNumber(from);
            console.log(`📱 Looking for active assessments for: ${standardizedFrom}`);
            
            try {
                const activeAssessments = await SymptomModel.getActiveAssessments(standardizedFrom);
                console.log(`📱 Found ${activeAssessments.length} active assessments`);
                
                if (activeAssessments.length > 0) {
                    // Use the most recent assessment
                    const assessment = activeAssessments[0];
                    const assessmentId = assessment.assessmentId;
                    console.log(`📱 Processing follow-up for assessment: ${assessmentId}`);
                    
                    // Process the follow-up
                    const result = await followUpService.processFollowUpResponse(
                        standardizedFrom,
                        assessmentId,
                        incomingMsg
                    );
                    
                    if (result.success) {
                        console.log(`📱 Successfully processed follow-up response`);
                        
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

        // PRIORITY 2: Account management and existence checks
        const userExists = await userService.checkUserExists(from);
        
        // Handle account creation flow
        if (!userExists && (incomingMsgLower === "create an account" || incomingMsgLower === "create account")) {
            return await accountHandler.startAccountCreation(req, res);
        }
        
        // Handle ongoing account creation flow
        if (sessionStore.getAccountCreationSession(from)) {
            return await accountHandler.continueAccountCreation(req, res);
        }

        // If user doesn't exist and isn't in account creation flow, prompt to create account
        if (!userExists) {
            await sendWhatsAppMessage(from, 
                `Welcome to Sukoon Saarthi! It seems you don't have an account yet.\n\n` +
                `To create an account, please reply with "create account".`
            );
            return res.status(200).send("Asked to create account");
        }

        // Handle proxy commands (child managing parent's account)
        const proxyCommand = parseProxyCommand(incomingMsg);
        if (proxyCommand) {
            return await handleProxyCommand(req, res, proxyCommand);
        }
        
        // Welcome Message
        if (incomingMsgLower === "hi" || incomingMsgLower === "hello") {
            return await menuHandler.showWelcomeMenu(req, res);
        }

        // Get the current sessions
        const standardizedFrom = standardizePhoneNumber(from);
        let userSession = sessionStore.getUserSession(from);
        
        // If session not found with original format, try standardized format
        if (!userSession) {
            userSession = sessionStore.getUserSession(standardizedFrom);
            console.log(`Looking for session with standardized phone: ${standardizedFrom}`);
        }
        
        const medicationSession = sessionStore.getMedicationSession(from);

        // PRIORITY 3: Ongoing conversation flows
        // Continue medication add flow - CHECK THIS FIRST
        if (medicationSession && medicationSession.stage && 
            (medicationSession.stage === 1 || 
             medicationSession.stage === 2 || 
             medicationSession.stage.toString().startsWith('add_'))) {
            return await medicationHandler.continueAddMedication(req, res);
        }
        
        // Continue medication update flow - CHECK THIS SECOND
        if (medicationSession && medicationSession.stage && 
            medicationSession.stage.toString().startsWith('update_')) {
            return await medicationHandler.continueMedicationUpdate(req, res);
        }
        
        // Continue medication deletion flow - CHECK THIS THIRD
        if (medicationSession && medicationSession.stage && 
            medicationSession.stage.toString().startsWith('delete_')) {
            return await medicationHandler.continueMedicationDeletion(req, res);
        }

        // Handle symptom follow-up responses - Check with full "from" format
        if (userSession && userSession.type === 'follow_up') {
            console.log(`Found follow-up session for ${from}, handling follow-up response`);
            return await followUpHandler.handleFollowUpResponse(req, res);
        }

        // Handle main menu selection
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

        // Handle "back to menu" option
        if (incomingMsgLower === "menu" || incomingMsgLower === "main menu" || 
            incomingMsgLower === "back" || incomingMsgLower === "7") {
            await menuHandler.sendMainMenu(from);
            return res.status(200).send("Returned to main menu.");
        }
        
        // Start symptom assessment
        if (incomingMsgLower === "symptom") {
            return await symptomHandler.startSymptomAssessment(req, res);
        }

        // Process symptom assessment steps
        if (userSession && userSession.type === 'symptom') {
            return await symptomHandler.continueSymptomAssessment(req, res);
        }
        
        // Check symptom status explicitly requested
        if (incomingMsgLower === "check symptom status" || incomingMsgLower === "symptom status") {
            return await followUpHandler.showSymptomStatus(req, res);
        }
        
        // Start medication update flow
        if (incomingMsgLower === "update medicine") {
            return await medicationHandler.startMedicationUpdate(req, res);
        }

        // Start medication add flow
        if (incomingMsgLower === "add medicine") {
            return await medicationHandler.startAddMedication(req, res);
        }
        
        // Start medication delete flow
        if (incomingMsgLower === "delete medicine" || incomingMsgLower === "remove medicine") {
            return await medicationHandler.startMedicationDeletion(req, res);
        }
        
        // Handle medication history requests
        if (incomingMsgLower === "show medication history last week") {
            return await medicationHandler.showMedicationHistory(req, res, 7);
        } else if (incomingMsgLower === "show all medication history") {
            return await medicationHandler.showMedicationHistory(req, res, null);
        }
        
        // Medication Information Request
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

        // AI Response for any other query
        console.log(`No specific handler matched, sending AI response`);
        const aiResponse = await aiResponseService.getAIResponse(incomingMsg);
        await sendWhatsAppMessage(from, aiResponse);
        return res.status(200).send("AI response sent.");

    } catch (error) {
        console.error("❌ Error processing webhook request:", error);
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