// handlers/medicationHandler.js - Logic for medication commands/flows
const medicationService = require('../services/medicationService');
const medicationInfoService = require('../services/medicationInfoService');
const { sendWhatsAppMessage } = require('../services/messageService');
const { ReminderModel } = require('../models/dbModels');
const sessionStore = require('../models/sessionStore');
const menuHandler = require('./menuHandler');
const { standardizePhoneNumber } = require('../utils/messageUtils'); 

/**
 * Handle medication info selection
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleMedicationInfoSelection(req, res) {
    const from = req.body.From;
    const incomingMsg = req.body.Body.trim();
    const userSession = sessionStore.getUserSession(from);

    // Process the selection of which medication to get info about
    const medicationIndex = parseInt(incomingMsg) - 1;
    
    if (isNaN(medicationIndex) || medicationIndex < 0 || medicationIndex >= userSession.medications.length) {
        await sendWhatsAppMessage(from, "Please enter a valid number from the list.");
        return res.status(200).send("Invalid medication number for info.");
    }
    
    const selectedMedication = userSession.medications[medicationIndex];
    
    // Use the medication info service to get information
    const medicationInfo = await medicationInfoService.getMedicationInfo(
        selectedMedication.medicine, 
        selectedMedication.dosage
    );
    
    await sendWhatsAppMessage(from, medicationInfo);
    
    setTimeout(async () => {
        await menuHandler.sendMainMenu(from);  
    }, 2000);
    
    return res.status(200).send("Medication information sent.");
}

/**
 * Start the process of updating a medication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function startMedicationUpdate(req, res) {
    const from = req.body.From;
    
    // Initialize session with update start stage
    sessionStore.setMedicationSession(from, { stage: 'update_start' });
    
    // Get all medications for the user
    const medications = await medicationService.getUserMedications(from);
    
    if (medications.length === 0) {
        await sendWhatsAppMessage(from, "You don't have any medications set up yet. Type 'add medicine' to add one.");
        sessionStore.deleteMedicationSession(from);
        return res.status(200).send("No medications found.");
    }
    
    // Create a numbered list of medications
    let medicineList = "Which medication would you like to update?\n\n";
    medications.forEach((med, index) => {
        medicineList += `${index + 1}. ${med.medicine}${med.dosage ? ` (${med.dosage})` : ''}\n`;
    });
    
    // Store medications in session for later reference
    const medicationSession = sessionStore.getMedicationSession(from);
    medicationSession.medications = medications;
    sessionStore.setMedicationSession(from, medicationSession);
    
    await sendWhatsAppMessage(from, medicineList);
    return res.status(200).send("Asked which medication to update.");
}

/**
 * Continue the medication update process
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function continueMedicationUpdate(req, res) {
    const from = req.body.From;
    const incomingMsg = req.body.Body.trim();
    const incomingMsgLower = incomingMsg.toLowerCase();
    const medicationSession = sessionStore.getMedicationSession(from);
    
    // Handle each stage of the update process
    switch (medicationSession.stage) {
        case 'update_start':
            // Select which medication to update
            const medicationIndex = parseInt(incomingMsg) - 1;
            
            if (isNaN(medicationIndex) || medicationIndex < 0 || medicationIndex >= medicationSession.medications.length) {
                await sendWhatsAppMessage(from, "Please enter a valid number from the list.");
                return res.status(200).send("Invalid medication number.");
            }
            
            const selectedMedication = medicationSession.medications[medicationIndex];
            medicationSession.oldMedicineName = selectedMedication.medicine;
            medicationSession.stage = 'update_name';
            
            // Store current values for reference
            medicationSession.currentValues = {
                name: selectedMedication.medicine,
                dosage: selectedMedication.dosage || 'Not specified',
                time: selectedMedication.time,
                frequency: selectedMedication.frequency || 'daily',
                duration: selectedMedication.duration || 'ongoing'
            };
            
            sessionStore.setMedicationSession(from, medicationSession);
            
            await sendWhatsAppMessage(from, `You selected: ${selectedMedication.medicine}\n\nPlease enter the new name for this medication (or type 'same' to keep it the same):`);
            return res.status(200).send("Asked for new medication name.");
            
        case 'update_name':
            // Update the medication name
            const newMedicineName = incomingMsgLower === 'same' ? 
                medicationSession.oldMedicineName : incomingMsg;
            
            medicationSession.newMedicineName = newMedicineName;
            medicationSession.stage = 'update_dosage';
            sessionStore.setMedicationSession(from, medicationSession);
            
            await sendWhatsAppMessage(from, `Please enter the dosage for ${newMedicineName} (e.g., "500mg" or type 'same' to keep "${medicationSession.currentValues.dosage}"):`);
            return res.status(200).send("Asked for dosage.");
            
        case 'update_dosage':
            // Update the dosage
            const dosage = incomingMsgLower === 'same' ? 
                medicationSession.currentValues.dosage : 
                (incomingMsgLower === 'none' ? null : incomingMsg);
            
            medicationSession.dosage = dosage;
            medicationSession.stage = 'update_time';
            sessionStore.setMedicationSession(from, medicationSession);
            
            await sendWhatsAppMessage(from, `Current reminder time is ${medicationSession.currentValues.time}. Please enter the new time (Format: HH:MM AM/PM) or type 'same' to keep it the same:`);
            return res.status(200).send("Asked for time.");
            
        case 'update_time':
            // Update the time
            const time = incomingMsgLower === 'same' ? 
                null : incomingMsg; // null means keep the same
            
            medicationSession.time = time;
            medicationSession.stage = 'update_frequency';
            sessionStore.setMedicationSession(from, medicationSession);
            
            await sendWhatsAppMessage(from, `Current frequency is "${medicationSession.currentValues.frequency}". How many times per day should this medicine be taken?\n\n1️⃣ Once daily\n2️⃣ Twice daily\n3️⃣ Three times daily\n4️⃣ Four times daily\n\nReply with the number, specify a different frequency, or type 'same' to keep it the same:`);
            return res.status(200).send("Asked for frequency.");
            
        case 'update_frequency':
            // Update the frequency
            let frequency;
            
            if (incomingMsgLower === 'same') {
                frequency = null; // null means keep the same
            } else {
                // Handle numeric responses
                if (incomingMsg === "1") frequency = "once daily";
                else if (incomingMsg === "2") frequency = "twice daily";
                else if (incomingMsg === "3") frequency = "three times a day";
                else if (incomingMsg === "4") frequency = "four times a day";
                else frequency = incomingMsg; // Custom frequency
            }
            
            medicationSession.frequency = frequency;
            medicationSession.stage = 'update_duration';
            sessionStore.setMedicationSession(from, medicationSession);
            
            const currentDuration = medicationSession.currentValues.duration;
            const durationText = currentDuration === 'ongoing' ? 
                "ongoing (no end date)" : 
                `${currentDuration} days`;
            
            await sendWhatsAppMessage(from, `Current duration is ${durationText}. For how many days should this medicine be taken? (Type a number, 'ongoing' for medications without an end date, or 'same' to keep it the same)`);
            return res.status(200).send("Asked for duration.");
            
        case 'update_duration':
            // Update the duration and complete
            let duration;
            
            if (incomingMsgLower === 'same') {
                duration = undefined; // undefined means don't update
            } else if (incomingMsgLower === 'ongoing') {
                duration = null; // null means ongoing
            } else {
                duration = incomingMsg; // String with number of days
            }
            
            medicationSession.duration = duration;
            sessionStore.setMedicationSession(from, medicationSession);
            
            // Perform the update
            const result = await medicationService.updateMedication(
                from,
                medicationSession.oldMedicineName,
                medicationSession.newMedicineName,
                medicationSession.dosage,
                medicationSession.time,
                medicationSession.frequency,
                medicationSession.duration
            );
            
            if (result.success) {
                const updated = result.updatedValues;
                
                // Format the reminder times for display
                const timeText = updated.reminderTimes.length > 1 ? 
                    `*Times:* ${updated.reminderTimes.join(', ')}` : 
                    `*Time:* ${updated.time}`;
                
                const durationText = updated.duration === null ? 
                    "*Duration:* Ongoing" : 
                    `*Duration:* ${updated.duration} days`;
                
                await sendWhatsAppMessage(
                    from, 
                    `✅ Medication updated successfully!\n\n*Medicine:* ${updated.name}\n*Dosage:* ${updated.dosage || 'Not specified'}\n*Frequency:* ${updated.frequency}\n${timeText}\n${durationText}`
                );
                
                // Clean up session
                sessionStore.deleteMedicationSession(from);
                
                // Return to main menu after updating
                setTimeout(async () => {
                    await menuHandler.sendMainMenu(from);
                }, 2000);
                
                return res.status(200).send("Medication updated.");
            } else {
                await sendWhatsAppMessage(from, "❌ Sorry, there was an error updating your medication. Please try again later.");
                sessionStore.deleteMedicationSession(from);
                return res.status(200).send("Medication update failed.");
            }
    }
}

/**
 * Start the process of adding a medication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function startAddMedication(req, res) {
    const from = req.body.From;
    
    // Initialize medication session
    sessionStore.setMedicationSession(from, { 
        stage: 1,
        isProxy: false,
        targetPhone: from
    });
    
    await sendWhatsAppMessage(from, "Please enter the medicine name:");
    return res.status(200).send("Medication entry started.");
}

/**
 * Continue the process of adding a medication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function continueAddMedication(req, res) {
    const from = req.body.From;
    const incomingMsg = req.body.Body.trim();
    const incomingMsgLower = incomingMsg.toLowerCase();
    const medicationSession = sessionStore.getMedicationSession(from);
    
    // Handle each stage of the add process
    switch (medicationSession.stage) {
        case 1:
            // Store medicine name
            medicationSession.medicine = incomingMsg;
            medicationSession.stage = 2;
            sessionStore.setMedicationSession(from, medicationSession);
            
            await sendWhatsAppMessage(from, "At what time should I remind you? (Format: HH:MM AM/PM)");
            return res.status(200).send("Asked for medication time.");
            
        case 2:
            // Store medication time
            medicationSession.time = incomingMsg;
            medicationSession.stage = 'add_dosage';
            sessionStore.setMedicationSession(from, medicationSession);
            
            await sendWhatsAppMessage(from, "Please enter the dosage (e.g., '500mg') or type 'none' if not applicable:");
            return res.status(200).send("Asked for dosage.");
            
        case 'add_dosage':
            // Store dosage
            medicationSession.dosage = incomingMsgLower === 'none' ? null : incomingMsg;
            medicationSession.stage = 'add_frequency';
            sessionStore.setMedicationSession(from, medicationSession);
            
            await sendWhatsAppMessage(from, "How many times per day do you need to take this medicine?\n\n1️⃣ Once daily\n2️⃣ Twice daily\n3️⃣ Three times daily\n4️⃣ Four times daily\n\nReply with the number or specify a different frequency (e.g., '5 times a day'):");
            return res.status(200).send("Asked for frequency.");
            
        case 'add_frequency':
            // Store frequency
            let frequency;
            
            // Handle numeric responses
            if (incomingMsg === "1") frequency = "once daily";
            else if (incomingMsg === "2") frequency = "twice daily";
            else if (incomingMsg === "3") frequency = "three times a day";
            else if (incomingMsg === "4") frequency = "four times a day";
            else frequency = incomingMsg; // Custom frequency
            
            medicationSession.frequency = frequency;
            medicationSession.stage = 'add_duration';
            sessionStore.setMedicationSession(from, medicationSession);
            
            await sendWhatsAppMessage(from, "For how many days do you need to take this medicine? (Type a number or 'ongoing' for medications without an end date)");
            return res.status(200).send("Asked for duration.");
            
        case 'add_duration':
            // Store duration and complete
            const duration = incomingMsgLower === 'ongoing' ? null : incomingMsg;
            const targetPhone = medicationSession.targetPhone || from;
            const isProxy = medicationSession.isProxy || false;
            const proxyUser = isProxy ? from : null;
            
            // Add the medication
            const result = await medicationService.addMedication(
                targetPhone,
                medicationSession.medicine,
                medicationSession.time,
                medicationSession.dosage,
                medicationSession.frequency,
                duration,
                proxyUser
            );
            
            if (result.success) {
                const data = result.data;
                
                // Format the reminder times for display
                const timeText = data.reminderTimes.length > 1 ? 
                    `*Times:* ${data.reminderTimes.join(', ')}` : 
                    `*Time:* ${data.time}`;
                
                const durationText = data.duration ? `*Duration:* ${data.duration} days` : "*Duration:* Ongoing";
                
                const successMessage = `✅ Medication added successfully!\n\n*Medicine:* ${data.medicine}\n*Dosage:* ${data.dosage || 'Not specified'}\n*Frequency:* ${data.frequency}\n${timeText}\n${durationText}`;
                
                await sendWhatsAppMessage(from, successMessage);
                
                // If proxy user, also send confirmation
                if (isProxy && targetPhone !== from) {
                    await sendWhatsAppMessage(from, `The medication has been added for ${targetPhone}.`);
                }
                
                // Clean up session
                sessionStore.deleteMedicationSession(from);
                
                setTimeout(async () => {
                    await menuHandler.sendMainMenu(from);
                }, 2000);
                
                return res.status(200).send("Medication saved.");
            } else {
                await sendWhatsAppMessage(from, "❌ Sorry, there was an error adding your medication. Please try again later.");
                sessionStore.deleteMedicationSession(from);
                return res.status(200).send("Failed to save medication.");
            }
    }
}

/**
 * Handle medication taken response
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleMedicationTaken(req, res) {
    const from = req.body.From;
    console.log(`⚠️ Processing "yes" response from ${from}`);
    
    // Get the latest reminder from DynamoDB
    const latestReminder = await ReminderModel.getLatestReminder(from);
    console.log(`📋 Latest reminder:`, latestReminder);
    
    if (latestReminder && !latestReminder.responded) {
        const medicineName = latestReminder.medicine;
        console.log(`🔍 Found medicine to mark as taken: ${medicineName}`);
        
        const success = await medicationService.markMedicationAsTaken(from, medicineName);
        
        if (success) {
            await sendWhatsAppMessage(from, `✅ Great! I've marked *${medicineName}* as taken.`);
            
            // Update reminder status in database - using expression attribute names for reserved keywords
            try {
                await ReminderModel.updateReminder(latestReminder.reminderId, {
                    updateExpression: "set responded = :r, #s = :s",
                    expressionAttributeValues: { 
                        ":r": true,
                        ":s": "taken" 
                    },
                    expressionAttributeNames: {
                        "#s": "status"  // Use expression attribute name for reserved keyword
                    }
                });
                console.log(`✅ Successfully updated reminder ${latestReminder.reminderId}`);
            } catch (error) {
                console.error(`❌ Error updating reminder status: ${error.message}`);
            }
        } else {
            await sendWhatsAppMessage(from, `⚠️ Sorry, I couldn't mark ${medicineName} as taken. Please try again later.`);
        }
        
        return res.status(200).send("Medication marked as taken.");
    } else {
        console.log(`❌ No pending reminder found for ${from}`);
        await sendWhatsAppMessage(from, "I'm not sure which medication you're referring to. Please specify the medicine name.");
        return res.status(200).send("Unknown medication reference.");
    }
}

/**
 * Handle medication missed response
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleMedicationMissed(req, res) {
    const from = req.body.From;
    console.log(`⚠️ Processing "no" response from ${from}`);
    
    // Get the latest reminder from DynamoDB
    const latestReminder = await ReminderModel.getLatestReminder(from);
    console.log(`📋 Latest reminder:`, latestReminder);
    
    if (latestReminder && !latestReminder.responded) {
        const medicineName = latestReminder.medicine;
        console.log(`🔍 Found medicine to mark as missed: ${medicineName}`);
        
        // Mark as missed and schedule follow-up
        const success = await medicationService.markMedicationAsMissed(from, medicineName);
        
        if (success) {
            // Update reminder status in database - using expression attribute names for reserved keywords
            try {
                await ReminderModel.updateReminder(latestReminder.reminderId, {
                    updateExpression: "set responded = :r, #s = :s",
                    expressionAttributeValues: { 
                        ":r": true,
                        ":s": "missed" 
                    },
                    expressionAttributeNames: {
                        "#s": "status"  // Use expression attribute name for reserved keyword
                    }
                });
                console.log(`✅ Successfully updated reminder ${latestReminder.reminderId}`);
            } catch (error) {
                console.error(`❌ Error updating reminder status: ${error.message}`);
            }
            
            // Schedule follow-up reminder
            await medicationService.scheduleFollowUpReminder(from, medicineName);
            
            await sendWhatsAppMessage(from, `❗ No problem! I'll remind you to take *${medicineName}* again in 30 minutes.`);
        } else {
            await sendWhatsAppMessage(from, `⚠️ Sorry, I couldn't process your response. I'll still remind you again later.`);
        }
        
        return res.status(200).send("Reminder rescheduled.");
    } else {
        console.log(`❌ No pending reminder found for ${from}`);
        await sendWhatsAppMessage(from, "I'm not sure which medication you're referring to. Please specify the medicine name.");
        return res.status(200).send("Unknown medication reference.");
    }
}

/**
 * Show medication history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number|null} lastNDays - Number of days to look back, or null for all time
 */
async function showMedicationHistory(req, res, lastNDays = null) {
    const from = req.body.From;
    
    console.log(`📋 Getting medication history for ${from}, last ${lastNDays || 'all'} days`);
    
    // Get user medications directly to check if there are any
    const medications = await medicationService.getUserMedications(from);
    console.log(`Found ${medications.length} medications:`, JSON.stringify(medications, null, 2));
    
    if (medications.length === 0) {
        await sendWhatsAppMessage(from, "You don't have any medications set up yet. Type 'add medicine' to add one.");
        
        setTimeout(async () => {
            await menuHandler.sendMainMenu(from);
        }, 2000);
        
        return res.status(200).send("No medications found.");
    }
    
    const history = await medicationService.getMedicationHistory(from, lastNDays);
    
    // If the history is just the header, show a more helpful message
    if (history.trim() === `📜 *Medication History for ${standardizePhoneNumber(from)}*:`) {
        await sendWhatsAppMessage(from, 
            `You have ${medications.length} medications set up, but no history of taking them has been recorded yet.\n\n` +
            `Your medication history will be displayed here once you start responding to medication reminders.`
        );
    } else {
        await sendWhatsAppMessage(from, history);
    }
    
    setTimeout(async () => {
        await menuHandler.sendMainMenu(from);
    }, 2000);
    
    const timeRange = lastNDays ? `last ${lastNDays} days` : 'all-time';
    return res.status(200).send(`Medication history (${timeRange}) sent.`);
}


/**
 * Start medication deletion process
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function startMedicationDeletion(req, res) {
    const from = req.body.From;
    
    // Get all medications for the user
    const medications = await medicationService.getUserMedications(from);
    
    if (medications.length === 0) {
        await sendWhatsAppMessage(from, "You don't have any medications set up yet. Type 'add medicine' to add one.");
        sessionStore.deleteMedicationSession(from);
        
        setTimeout(async () => {
            await menuHandler.sendMainMenu(from);
        }, 2000);
        
        return res.status(200).send("No medications found.");
    }
    
    // Create a numbered list of medications
    let medicineList = "Which medication would you like to delete?\n\n";
    medications.forEach((med, index) => {
        medicineList += `${index + 1}. ${med.medicine}${med.dosage ? ` (${med.dosage})` : ''}\n`;
    });
    
    medicineList += "\nPlease reply with the number of your choice.";
    
    // Store medications in session for later reference
    sessionStore.setMedicationSession(from, { 
        stage: 'delete_select',
        medications: medications
    });
    
    await sendWhatsAppMessage(from, medicineList);
    return res.status(200).send("Asked which medication to delete.");
}

/**
 * Continue medication deletion process
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function continueMedicationDeletion(req, res) {
    const from = req.body.From;
    const incomingMsg = req.body.Body.trim();
    const medicationSession = sessionStore.getMedicationSession(from);
    
    if (medicationSession.stage === 'delete_select') {
        // Process medication selection
        const medicationIndex = parseInt(incomingMsg) - 1;
        
        if (isNaN(medicationIndex) || medicationIndex < 0 || medicationIndex >= medicationSession.medications.length) {
            await sendWhatsAppMessage(from, "Please enter a valid number from the list.");
            return res.status(200).send("Invalid medication number.");
        }
        
        const selectedMedication = medicationSession.medications[medicationIndex];
        medicationSession.selectedMedicine = selectedMedication.medicine;
        medicationSession.stage = 'delete_confirm';
        sessionStore.setMedicationSession(from, medicationSession);
        
        await sendWhatsAppMessage(from, 
            `Are you sure you want to delete *${selectedMedication.medicine}*?\n\n` +
            `This will also delete all reminders for this medication.\n\n` +
            `Reply with *Yes* to confirm or *No* to cancel.`
        );
        
        return res.status(200).send("Asked for deletion confirmation.");
    } 
    else if (medicationSession.stage === 'delete_confirm') {
        const incomingMsgLower = incomingMsg.toLowerCase();
        
        if (incomingMsgLower === 'yes' || incomingMsgLower === 'y') {
            // Confirm deletion
            const medicine = medicationSession.selectedMedicine;
            
            const success = await medicationService.deleteMedication(from, medicine);
            
            if (success) {
                await sendWhatsAppMessage(from, `✅ The medication *${medicine}* has been deleted successfully.`);
            } else {
                await sendWhatsAppMessage(from, `❌ Sorry, there was an error deleting the medication. Please try again later.`);
            }
            
            // Clean up session
            sessionStore.deleteMedicationSession(from);
            
            // Return to main menu
            setTimeout(async () => {
                await menuHandler.sendMainMenu(from);
            }, 2000);
            
            return res.status(200).send("Medication deleted.");
        } 
        else {
            // Cancellation
            await sendWhatsAppMessage(from, "Deletion cancelled. Your medication has not been changed.");
            
            // Clean up session
            sessionStore.deleteMedicationSession(from);
            
            // Return to main menu
            setTimeout(async () => {
                await menuHandler.sendMainMenu(from);
            }, 2000);
            
            return res.status(200).send("Deletion cancelled.");
        }
    }
    
    // If we get here, something went wrong with the session
    await sendWhatsAppMessage(from, "Sorry, there was an error with your request. Let's start again.");
    sessionStore.deleteMedicationSession(from);
    
    setTimeout(async () => {
        await menuHandler.sendMainMenu(from);
    }, 2000);
    
    return res.status(200).send("Error in deletion flow.");
}

module.exports = {
    handleMedicationInfoSelection,
    startMedicationUpdate,
    continueMedicationUpdate,
    startAddMedication,
    continueAddMedication,
    handleMedicationTaken,
    handleMedicationMissed,
    showMedicationHistory,
    startMedicationDeletion,
    continueMedicationDeletion
};