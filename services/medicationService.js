// services/medicationService.js - Medication management
const { MedicationModel, ReminderModel } = require('../models/dbModels');
const { standardizeTimeFormat, generateReminderTimes, formatDate, calculateEndDate } = require('../utils/timeUtils');
const { sendWhatsAppMessage } = require('./messageService');
const { standardizePhoneNumber } = require('../utils/messageUtils');
const reminderService = require('./reminderService');

/**
 * Add a medication to the database with proxy support
 * @param {string} userPhone - User's phone number
 * @param {string} medicine - Medicine name
 * @param {string} time - Reminder time
 * @param {string} dosage - Medicine dosage
 * @param {string} frequency - Frequency of medicine
 * @param {string} duration - Duration of medicine
 * @param {string} proxyUser - Who added the medication (if proxy)
 * @returns {Promise<Object>} - Result with success status and data
 */
async function addMedication(userPhone, medicine, time, dosage = null, frequency = "daily", duration = null, proxyUser = null) {
    try {
        const standardizedPhone = standardizePhoneNumber(userPhone);
        const formattedTime = standardizeTimeFormat(time);
        const reminderTimes = generateReminderTimes(formattedTime, frequency);
        
        const endDate = calculateEndDate(duration);
        
        // Add the medication to the database
        const success = await MedicationModel.addMedication(
            standardizedPhone,
            medicine,
            formattedTime,
            dosage,
            frequency,
            duration,
            proxyUser
        );

        if (!success) {
            return { success: false };
        }
        
        // If added by proxy, notify the parent
        if (proxyUser) {
            // Get proxy user name from user service
            const proxyUserStandardized = standardizePhoneNumber(proxyUser);
            
            // Get user details
            const { UserModel } = require('../models/dbModels');
            const proxyUserResult = await UserModel.getUserDetails(proxyUserStandardized);
            
            const proxyName = proxyUserResult ? proxyUserResult.name : "Your caregiver";
            
            await sendWhatsAppMessage(
                standardizedPhone,
                `${proxyName} has added a new medication for you: ${medicine} (${dosage || 'No dosage specified'}) at ${formattedTime}`
            );
        }
        
        return { 
            success: true,
            data: {
                medicine,
                time: formattedTime,
                reminderTimes,
                dosage,
                frequency,
                duration,
                endDate
            }
        };
    } catch (error) {
        console.error(`❌ Error adding medication: ${error}`);
        return { success: false };
    }
}

/**
 * Update a medication
 * @param {string} userPhone - User's phone number
 * @param {string} oldMedicineName - Old medicine name
 * @param {string} newMedicineName - New medicine name
 * @param {string} dosage - Medicine dosage
 * @param {string} time - Reminder time
 * @param {string} frequency - Frequency of medicine
 * @param {string} duration - Duration of medicine
 * @returns {Promise<Object>} - Result with success status and updated values
 */
async function updateMedication(userPhone, oldMedicineName, newMedicineName, dosage, time = null, frequency = null, duration = null) {
    try {
        const standardizedPhone = standardizePhoneNumber(userPhone);
        
        // First, check if the medication exists
        const medications = await MedicationModel.getUserMedications(standardizedPhone);
        const medicationToUpdate = medications.find(med => 
            med.medicine.toLowerCase() === oldMedicineName.toLowerCase()
        );
        
        if (!medicationToUpdate) {
            console.error(`❌ Medicine "${oldMedicineName}" not found for user ${standardizedPhone}`);
            return { success: false };
        }
        
        // Use new values or keep the old ones if not provided
        const updatedName = newMedicineName || medicationToUpdate.medicine;
        const updatedDosage = dosage || medicationToUpdate.dosage || "Not specified";
        const updatedTime = time ? standardizeTimeFormat(time) : medicationToUpdate.time;
        const updatedFrequency = frequency || medicationToUpdate.frequency || "daily";
        
        // Handle duration update
        let updatedDuration = duration !== undefined ? duration : medicationToUpdate.duration;
        let updatedEndDate = medicationToUpdate.endDate;
        
        // If duration is explicitly updated, recalculate end date
        if (duration !== undefined) {
            updatedEndDate = calculateEndDate(duration);
        }
        
        // Generate new reminder times if time or frequency has changed
        let updatedReminderTimes = medicationToUpdate.reminderTimes;
        if (time || frequency) {
            updatedReminderTimes = generateReminderTimes(
                updatedTime, 
                updatedFrequency
            );
        }
        
        // Prepare the update data
        let updateData;
        
        // If the medicine name hasn't changed, we can use update
        if (oldMedicineName.toLowerCase() === updatedName.toLowerCase()) {
            updateData = {
                updateExpression: "set dosage = :d, #time = :t, reminderTimes = :rt, frequency = :f, #duration = :du, endDate = :e",
                expressionAttributeValues: {
                    ":d": updatedDosage,
                    ":t": updatedTime,
                    ":rt": updatedReminderTimes,
                    ":f": updatedFrequency,
                    ":du": updatedDuration,
                    ":e": updatedEndDate
                },
                expressionAttributeNames: {
                    "#time": "time",
                    "#duration": "duration"
                }
            };
        } else {
            // If name changed, prepare data for replacing the record
            updateData = {
                newMedicineName: updatedName,
                newItem: {
                    dosage: updatedDosage,
                    time: updatedTime,
                    reminderTimes: updatedReminderTimes,
                    frequency: updatedFrequency,
                    duration: updatedDuration,
                    endDate: updatedEndDate
                }
            };
        }
        
        // Perform the update
        const result = await MedicationModel.updateMedication(
            standardizedPhone,
            oldMedicineName,
            updateData
        );
        
        if (!result.success) {
            return { success: false };
        }
        
        console.log(`✅ Updated medication for ${standardizedPhone}: ${oldMedicineName} -> ${updatedName}`);
        return {
            success: true,
            updatedValues: {
                name: updatedName,
                dosage: updatedDosage,
                time: updatedTime,
                frequency: updatedFrequency,
                duration: updatedDuration,
                reminderTimes: updatedReminderTimes,
                endDate: updatedEndDate
            }
        };
    } catch (error) {
        console.error(`❌ Error updating medication: ${error}`);
        return { success: false };
    }
}

/**
 * Mark a medication as taken
 * @param {string} userPhone - User's phone number
 * @param {string} medicine - Medicine name
 * @returns {Promise<boolean>} - Success status
 */
async function markMedicationAsTaken(userPhone, medicine) {
    const standardizedPhone = standardizePhoneNumber(userPhone);
    return await MedicationModel.markMedicationAsTaken(standardizedPhone, medicine);
}

/**
 * Schedule a follow-up reminder for a medication
 * @param {string} userPhone - User's phone number 
 * @param {string} medicine - Medicine name
 * @param {number} delayMinutes - Delay in minutes
 * @returns {Promise<boolean>} - Success status
 */
async function scheduleFollowUpReminder(userPhone, medicine, delayMinutes = 30) {
    try {
        const standardizedPhone = standardizePhoneNumber(userPhone);
        
        // Update the reminder status in the database
        const latestReminder = await ReminderModel.getLatestReminder(standardizedPhone);
        
        if (latestReminder) {
            try {
                await ReminderModel.updateReminder(latestReminder.reminderId, {
                    updateExpression: "set responded = :r, #s = :s",
                    expressionAttributeValues: { 
                        ":r": true,
                        ":s": "postponed" 
                    },
                    expressionAttributeNames: {
                        "#s": "status"  // Use expression attribute name for reserved keyword
                    }
                });
            } catch (error) {
                console.error(`❌ Error updating reminder for follow-up: ${error.message}`);
            }
        }
        
        // Schedule the follow-up reminder
        reminderService.scheduleReminderWithDelay(standardizedPhone, medicine, delayMinutes);
        
        return true;
    } catch (error) {
        console.error(`❌ Error scheduling follow-up reminder: ${error}`);
        return false;
    }
}
/**
 * Mark a medication as missed
 * @param {string} userPhone - User's phone number
 * @param {string} medicine - Medicine name
 * @returns {Promise<boolean>} - Success status
 */
async function markMedicationAsMissed(userPhone, medicine) {
    const standardizedPhone = standardizePhoneNumber(userPhone);
    return await MedicationModel.markMedicationAsMissed(standardizedPhone, medicine);
}

/**
 * Get medications for a user
 * @param {string} userPhone - User's phone number
 * @returns {Promise<Array>} - Array of medications
 */
async function getUserMedications(userPhone) {
    const standardizedPhone = standardizePhoneNumber(userPhone);
    return await MedicationModel.getUserMedications(standardizedPhone);
}

/**
 * Get medication history for a user
 * @param {string} userPhone - User's phone number
 * @param {number|null} lastNDays - Number of days to look back, or null for all
 * @returns {Promise<string>} - Formatted medication history
 */
async function getMedicationHistory(userPhone, lastNDays = null) {
    try {
        const standardizedPhone = standardizePhoneNumber(userPhone);
        const medications = await MedicationModel.getUserMedications(standardizedPhone);
        let responseMessage = `📜 *Medication History for ${standardizedPhone}*:\n\n`;
        const now = new Date();
        const pastDate = lastNDays ? new Date(now.setDate(now.getDate() - lastNDays)) : null;
        
        medications.forEach(med => {
            const takenTimes = med.takenTimes || [];
            const missedTimes = med.missedTimes || [];
            const filteredTaken = lastNDays ? takenTimes.filter(date => new Date(date) >= pastDate) : takenTimes;
            const filteredMissed = lastNDays ? missedTimes.filter(date => new Date(date) >= pastDate) : missedTimes;
            
            // Format each taken/missed timestamp
            const formattedTaken = filteredTaken.length 
                ? filteredTaken.map(date => formatDate(date)).join(', ') 
                : 'None';
            const formattedMissed = filteredMissed.length 
                ? filteredMissed.map(date => formatDate(date)).join(', ') 
                : 'None';
            
            responseMessage += `💊 *${med.medicine}*:\n`;
            responseMessage += `   - Dosage: ${med.dosage || 'Not specified'}\n`;
            responseMessage += `   - Reminder Time(s): ${Array.isArray(med.reminderTimes) ? med.reminderTimes.join(', ') : med.time}\n`;
            responseMessage += `   - Frequency: ${med.frequency || 'Not specified'}\n`;
            responseMessage += `   - Duration: ${med.duration ? med.duration + ' days' : 'Ongoing'}\n`;
            responseMessage += `   - Start Date: ${med.startDate ? formatDate(med.startDate) : 'N/A'}\n`;
            responseMessage += `   - End Date: ${med.endDate ? formatDate(med.endDate) : 'Ongoing'}\n`;
            responseMessage += `   - Taken: ${filteredTaken.length} times\n`;
            responseMessage += `       *Dates:* ${formattedTaken}\n`;
            responseMessage += `   - Missed: ${filteredMissed.length} times\n`;
            responseMessage += `       *Dates:* ${formattedMissed}\n\n`;
        });
        
        return responseMessage.trim();
    } catch (error) {
        console.error(`❌ Error fetching medication history: ${error}`);
        return "❌ Error fetching medication history. Please try again later.";
    }
}


/**
 * Delete a medication
 * @param {string} userPhone - User's phone number
 * @param {string} medicine - Medicine name
 * @returns {Promise<boolean>} - Success status
 */
async function deleteMedication(userPhone, medicine) {
    try {
        const standardizedPhone = standardizePhoneNumber(userPhone);
        
        // Verify the medicine exists
        const medications = await MedicationModel.getUserMedications(standardizedPhone);
        const medicationToDelete = medications.find(med => 
            med.medicine.toLowerCase() === medicine.toLowerCase()
        );
        
        if (!medicationToDelete) {
            console.error(`❌ Medicine "${medicine}" not found for user ${standardizedPhone}`);
            return false;
        }
        
        // Delete the medication
        const success = await MedicationModel.deleteMedication(standardizedPhone, medicationToDelete.medicine);
        
        if (success) {
            console.log(`✅ Successfully deleted medication ${medicine} for ${standardizedPhone}`);
        }
        
        return success;
    } catch (error) {
        console.error(`❌ Error deleting medication: ${error}`);
        return false;
    }
}


module.exports = {
    addMedication,
    updateMedication,
    markMedicationAsTaken,
    markMedicationAsMissed,
    scheduleFollowUpReminder,
    getUserMedications,
    getMedicationHistory,
    deleteMedication
};