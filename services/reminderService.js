// services/reminderService.js - Medication reminder scheduling and sending
const { MedicationModel, ReminderModel } = require('../models/dbModels');
const { sendReminderMessage } = require('./messageService');
const { standardizeTimeFormat, getCurrentTimeIST } = require('../utils/timeUtils');

let reminderInterval = null;

/**
 * Check for medication reminders to send
 */
async function checkAndSendReminders() {
    console.log("🔎 Checking for medication reminders...");

    try {
        // Get all medications from the database
        const medications = await MedicationModel.getUserMedications(null); // Get all medications
        const now = new Date();

        // Get current time in IST (12-hour format)
        const currentTime = getCurrentTimeIST();
        const standardizedCurrentTime = standardizeTimeFormat(currentTime);

        console.log(`🕒 Current IST Time: ${currentTime}`);

        for (const med of medications) {
            // Skip if medication has ended
            if (med.endDate && new Date(med.endDate) < now) {
                console.log(`⏱️ Medication ${med.medicine} has ended its duration.`);
                continue;
            }
            
            // Check each reminder time
            const reminderTimes = med.reminderTimes || [med.time];
            
            for (const reminderTime of reminderTimes) {
                if (!reminderTime) continue; 
                
                // Standardize medication time format for comparison
                const standardizedMedTime = standardizeTimeFormat(reminderTime);
                
                console.log(`💊 Checking medication: ${med.medicine}`);
                console.log(`   - Reminder time: "${reminderTime}"`);
                console.log(`   - Standardized reminder time: "${standardizedMedTime}"`);
                console.log(`   - Current time: "${standardizedCurrentTime}"`);

                // Compare the standardized time formats
                if (standardizedMedTime === standardizedCurrentTime && med.taken === false) {
                    console.log(`🚀 Sending reminder for ${med.medicine}`);
                    
                    // Create a reminder record
                    const reminderId = await ReminderModel.createReminder(
                        med.userPhone, 
                        med.medicine,
                        reminderTime
                    );
                    
                    if (reminderId) {
                        // Send the reminder message
                        const messageSent = await sendReminderMessage(
                            med.userPhone, 
                            med.medicine,
                            reminderId
                        );
                        
                        if (messageSent) {
                            // Update the reminder with the message status
                            await ReminderModel.updateReminder(reminderId, {
                                updateExpression: "set messageSent = :ms",
                                expressionAttributeValues: { ":ms": true }
                            });
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error("❌ Error fetching medications for reminders:", error);
    }
}

/**
 * Start the reminder scheduler
 */
function startReminderScheduler() {
    // Run immediately on startup
    checkAndSendReminders();
    
    // Run every minute
    reminderInterval = setInterval(checkAndSendReminders, 60000);
    console.log("⏰ Reminder scheduler started");
}

/**
 * Stop the reminder scheduler
 */
function stopReminderScheduler() {
    if (reminderInterval) {
        clearInterval(reminderInterval);
        reminderInterval = null;
        console.log("⏰ Reminder scheduler stopped");
    }
}

/**
 * Schedule a reminder for a specific time
 * @param {string} userPhone - User's phone number
 * @param {string} medicine - Medicine name
 * @param {number} delayMinutes - Delay in minutes
 */
function scheduleReminderWithDelay(userPhone, medicine, delayMinutes = 30) {
    console.log(`⏰ Scheduling reminder for ${medicine} in ${delayMinutes} minutes`);
    
    setTimeout(async () => {
        const reminderId = await ReminderModel.createReminder(userPhone, medicine, null);
        if (reminderId) {
            await sendReminderMessage(userPhone, medicine, reminderId);
        }
    }, delayMinutes * 60 * 1000);
}

module.exports = {
    startReminderScheduler,
    stopReminderScheduler,
    scheduleReminderWithDelay
};