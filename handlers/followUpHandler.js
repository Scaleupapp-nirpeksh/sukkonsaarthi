// handlers/followUpHandler.js - Logic for symptom follow-up interactions

const { sendWhatsAppMessage } = require('../services/messageService');
const followUpService = require('../services/followUpService');
const sessionStore = require('../models/sessionStore');
const menuHandler = require('./menuHandler');
const { SymptomModel } = require('../models/dbModels');
const { standardizePhoneNumber } = require('../utils/messageUtils');

/**
 * Handle follow-up response for a symptom assessment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleFollowUpResponse(req, res) {
    const from = req.body.From;
    const incomingMsg = req.body.Body.trim();
    
    // Try to get session with both formats
    const standardizedFrom = standardizePhoneNumber(from);
    let userSession = sessionStore.getUserSession(from);
    
    if (!userSession || userSession.type !== 'follow_up') {
        userSession = sessionStore.getUserSession(standardizedFrom);
        console.log(`Looking for follow-up session with standardized phone: ${standardizedFrom}`);
    }
    
    console.log(`Follow-up session check: ${userSession ? 'Found' : 'Not found'}`);
    
    // If no session found but received a numeric response (1-4), try to handle it directly
    if ((!userSession || userSession.type !== 'follow_up') && ['1', '2', '3', '4'].includes(incomingMsg)) {
        console.log(`No session found but received numeric response: ${incomingMsg}. Trying direct assessment lookup.`);
        
        // Try to find active assessments for this user
        try {
            const activeAssessments = await SymptomModel.getActiveAssessments(standardizedFrom);
            console.log(`Found ${activeAssessments.length} active assessments for manual follow-up`);
            
            if (activeAssessments.length > 0) {
                // Use the most recent assessment
                const assessment = activeAssessments[0];
                
                console.log(`Using assessment: ${assessment.assessmentId} for direct follow-up`);
                
                // Process response
                const result = await followUpService.processFollowUpResponse(
                    standardizedFrom,
                    assessment.assessmentId,
                    incomingMsg
                );
                
                if (result.success) {
                    await sendWhatsAppMessage(from, result.recommendations);
                    
                    if (result.isCompleted) {
                        await sendWhatsAppMessage(from, "✅ Thank you for using Sukoon Saarthi symptom tracking. Your symptom follow-up is now complete.");
                    } else {
                        await sendWhatsAppMessage(from, "I'll check in with you again tomorrow. If your symptoms change significantly before then, please use the symptom assessment option from the main menu.");
                    }
                    
                    setTimeout(async () => {
                        await menuHandler.sendMainMenu(from);
                    }, 2000);
                    
                    return res.status(200).send("Direct follow-up processed");
                }
            }
        } catch (error) {
            console.error(`❌ Error with direct assessment lookup: ${error}`);
        }
        
        // If we get here, we couldn't process the response directly
        await sendWhatsAppMessage(from, "I'm sorry, I couldn't process your response. Let's start again.");
        
        setTimeout(async () => {
            await menuHandler.sendMainMenu(from);
        }, 2000);
        
        return res.status(200).send("Invalid follow-up session");
    }
    
    if (!userSession || userSession.type !== 'follow_up') {
        await sendWhatsAppMessage(from, "I'm sorry, I couldn't process your response. Let's start again.");
        
        setTimeout(async () => {
            await menuHandler.sendMainMenu(from);
        }, 2000);
        
        return res.status(200).send("Invalid follow-up session");
    }
    
    if (userSession.stage === 'status') {
        console.log(`Processing follow-up status response for assessmentId: ${userSession.assessmentId}`);
        
        // Process the status response
        const result = await followUpService.processFollowUpResponse(
            standardizedFrom,
            userSession.assessmentId,
            incomingMsg
        );
        
        if (!result.success) {
            await sendWhatsAppMessage(from, "I'm sorry, there was an error processing your follow-up. Please try again later.");
            
            // Clean up session
            sessionStore.deleteUserSession(from);
            if (from !== standardizedFrom) {
                sessionStore.deleteUserSession(standardizedFrom);
            }
            
            setTimeout(async () => {
                await menuHandler.sendMainMenu(from);
            }, 2000);
            
            return res.status(200).send("Follow-up processing error");
        }
        
        // Send recommendations
        await sendWhatsAppMessage(from, result.recommendations);
        
        // If this was the final follow-up, clean up and return to main menu
        if (result.isCompleted) {
            await sendWhatsAppMessage(from, "✅ Thank you for using Sukoon Saarthi symptom tracking. Your symptom follow-up is now complete.");
            
            // Clean up session
            sessionStore.deleteUserSession(from);
            if (from !== standardizedFrom) {
                sessionStore.deleteUserSession(standardizedFrom);
            }
            
            setTimeout(async () => {
                await menuHandler.sendMainMenu(from);
            }, 2000);
        } else {
            await sendWhatsAppMessage(from, "I'll check in with you again tomorrow. If your symptoms change significantly before then, please use the symptom assessment option from the main menu.");
            
            // Clean up session
            sessionStore.deleteUserSession(from);
            if (from !== standardizedFrom) {
                sessionStore.deleteUserSession(standardizedFrom);
            }
            
            setTimeout(async () => {
                await menuHandler.sendMainMenu(from);
            }, 2000);
        }
        
        return res.status(200).send("Follow-up processed");
    } else if (userSession.stage === 'selection') {
        // Handle case where user has multiple active assessments
        const assessmentIndex = parseInt(incomingMsg) - 1;
        
        if (isNaN(assessmentIndex) || assessmentIndex < 0 || !userSession.assessments || assessmentIndex >= userSession.assessments.length) {
            await sendWhatsAppMessage(from, "Please enter a valid number from the list.");
            return res.status(200).send("Invalid assessment selection");
        }
        
        const selectedAssessment = userSession.assessments[assessmentIndex];
        
        // Update session for follow-up status
        sessionStore.setUserSession(from, {
            type: 'follow_up',
            stage: 'status',
            assessmentId: selectedAssessment.assessmentId
        });
        
        // Also set with standardized phone if different
        if (from !== standardizedFrom) {
            sessionStore.setUserSession(standardizedFrom, {
                type: 'follow_up',
                stage: 'status',
                assessmentId: selectedAssessment.assessmentId
            });
        }
        
        // Send the follow-up question
        const followUpCount = selectedAssessment.followUps ? selectedAssessment.followUps.length : 0;
        
        let followUpMessage = `👋 *Follow-up: ${selectedAssessment.primarySymptom}*\n\n`;
        followUpMessage += `How are you feeling now?\n\n`;
        followUpMessage += `1️⃣ Better/Improved\n`;
        followUpMessage += `2️⃣ About the same\n`;
        followUpMessage += `3️⃣ Worse\n`;
        followUpMessage += `4️⃣ Complete follow-up (symptom resolved or no longer wish to track)\n\n`;
        followUpMessage += `Please reply with the number of your choice.`;
        
        await sendWhatsAppMessage(from, followUpMessage);
        return res.status(200).send("Follow-up question sent");
    }
    
    // If we get here, something is wrong with the session state
    await sendWhatsAppMessage(from, "I'm sorry, something went wrong with your follow-up. Let's start again.");
    
    // Clean up session
    sessionStore.deleteUserSession(from);
    if (from !== standardizedFrom) {
        sessionStore.deleteUserSession(standardizedFrom);
    }
    
    setTimeout(async () => {
        await menuHandler.sendMainMenu(from);
    }, 2000);
    
    return res.status(200).send("Invalid follow-up stage");
}

/**
 * Show active symptom assessments and allow manual follow-up
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function showSymptomStatus(req, res) {
    const from = req.body.From;
    const standardizedFrom = standardizePhoneNumber(from);
    
    try {
        // Get active assessments
        const activeAssessments = await SymptomModel.getActiveAssessments(standardizedFrom);
        console.log(`Found ${activeAssessments.length} active assessments for status check`);
        
        if (activeAssessments.length === 0) {
            await sendWhatsAppMessage(from, 
                "You don't have any active symptom assessments. If you're experiencing symptoms, " +
                "you can start a new assessment by typing 'symptom'."
            );
            
            setTimeout(async () => {
                await menuHandler.sendMainMenu(from);
            }, 2000);
            
            return res.status(200).send("No active assessments.");
        }
        
        // If there is only one active assessment, start the follow-up process directly
        if (activeAssessments.length === 1) {
            const assessment = activeAssessments[0];
            console.log(`Starting direct follow-up for single assessment: ${assessment.assessmentId}`);
            
            // Store the assessment ID in the session with both phone formats
            sessionStore.setUserSession(from, {
                type: 'follow_up',
                stage: 'status',
                assessmentId: assessment.assessmentId
            });
            
            // Also store with standardized phone if different
            if (from !== standardizedFrom) {
                sessionStore.setUserSession(standardizedFrom, {
                    type: 'follow_up',
                    stage: 'status',
                    assessmentId: assessment.assessmentId
                });
            }
            
            // Create follow-up message
            const daysSinceStart = Math.floor((Date.now() - new Date(assessment.createdAt).getTime()) / (24 * 60 * 60 * 1000));
            const followUpCount = assessment.followUps ? assessment.followUps.length : 0;
            
            let followUpMessage = `👋 *Follow-up: ${assessment.primarySymptom}*\n\n`;
            followUpMessage += `It's been ${followUpCount > 0 ? 'another ' : ''}day since you reported ${assessment.primarySymptom}. How are you feeling now?\n\n`;
            followUpMessage += `1️⃣ Better/Improved\n`;
            followUpMessage += `2️⃣ About the same\n`;
            followUpMessage += `3️⃣ Worse\n`;
            followUpMessage += `4️⃣ Complete follow-up (symptom resolved or no longer wish to track)\n\n`;
            followUpMessage += `Please reply with the number of your choice.`;
            
            await sendWhatsAppMessage(from, followUpMessage);
            return res.status(200).send("Follow-up started for single assessment");
        }
        
        // If multiple assessments, ask which one to follow up on
        let selectionMessage = "You have multiple active symptom assessments. Which one would you like to update?\n\n";
        
        activeAssessments.forEach((assessment, index) => {
            const createdDate = new Date(assessment.createdAt).toLocaleDateString();
            selectionMessage += `${index + 1}. ${assessment.primarySymptom} (started on ${createdDate})\n`;
        });
        
        selectionMessage += "\nPlease reply with the number of your choice.";
        
        // Store the list of assessments in the session
        sessionStore.setUserSession(from, {
            type: 'follow_up',
            stage: 'selection',
            assessments: activeAssessments
        });
        
        // Also store with standardized phone if different
        if (from !== standardizedFrom) {
            sessionStore.setUserSession(standardizedFrom, {
                type: 'follow_up',
                stage: 'selection',
                assessments: activeAssessments
            });
        }
        
        await sendWhatsAppMessage(from, selectionMessage);
        return res.status(200).send("Asked which assessment to follow up on");
    } catch (error) {
        console.error(`❌ Error showing symptom status: ${error}`);
        await sendWhatsAppMessage(from, "I'm sorry, I couldn't retrieve your symptom status right now. Please try again later.");
        
        setTimeout(async () => {
            await menuHandler.sendMainMenu(from);
        }, 2000);
        
        return res.status(200).send("Error showing symptom status.");
    }
}

module.exports = {
    handleFollowUpResponse,
    showSymptomStatus
};