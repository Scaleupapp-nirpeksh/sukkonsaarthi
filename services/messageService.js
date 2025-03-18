// services/messageService.js - WhatsApp message handling
const { createTwilioClient } = require('../config/config');
const { splitMessageIntoChunks, formatWhatsAppNumber } = require('../utils/messageUtils');

const twilioClient = createTwilioClient();

/**
 * Send a WhatsApp message, splitting if necessary
 * @param {string} to - Recipient phone number
 * @param {string} message - Message to send
 * @returns {Promise<boolean>} - Success status
 */
async function sendWhatsAppMessage(to, message) {
    try {
        // Make sure both numbers have the whatsapp: prefix
        const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
        const formattedFrom = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
        const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
        
        console.log(`Sending from: ${formattedFrom} to: ${formattedTo}`);
        
        // Check if the message exceeds WhatsApp's character limit (1600 chars)
        if (message.length <= 1500) {
            // If within limit, send as a single message
            await twilioClient.messages.create({
                from: formattedFrom,
                to: formattedTo,
                body: message
            });
            console.log(`📤 Sent message to ${to} (${message.length} chars)`);
            return true;
        } else {
            // Split into multiple messages if too long
            console.log(`📏 Message length ${message.length} exceeds limit, splitting into multiple messages`);
            
            const chunks = splitMessageIntoChunks(message);
            
            // Send each chunk sequentially
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const chunkLabel = chunks.length > 1 ? `(${i+1}/${chunks.length}) ` : '';
                
                await twilioClient.messages.create({
                    from: formattedFrom,
                    to: formattedTo,
                    body: chunkLabel + chunk
                });
                
                console.log(`📤 Sent message chunk ${i+1}/${chunks.length} to ${to} (${chunk.length} chars)`);
                
                // Small delay between messages to maintain order
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            return true;
        }
    } catch (error) {
        console.error(`❌ Error sending message: ${error}`);
        return false;
    }
}

/**
 * Send a medication reminder message
 * @param {string} userPhone - User's phone number
 * @param {string} medicine - Medicine name
 * @param {string} reminderId - ID of the reminder
 * @returns {Promise<boolean>} - Success status
 */
async function sendReminderMessage(userPhone, medicine, reminderId) {
    try {
        const message = `🔔 Reminder: It's time to take your medicine - *${medicine}*. \n\nHave you taken it? ✅ Yes / ❌ No`;
        
        // Make sure both numbers have the whatsapp: prefix
        const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
        const formattedFrom = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
        const formattedTo = userPhone.startsWith('whatsapp:') ? userPhone : `whatsapp:${userPhone}`;
        
        const response = await twilioClient.messages.create({
            from: formattedFrom,
            to: formattedTo,
            body: message
        });
        
        console.log(`🚀 Sent medication reminder to ${userPhone}: ${medicine}`);
        console.log(`📜 Twilio Response: ${response.sid}`);
        
        return true;
    } catch (error) {
        console.error(`❌ Error sending reminder: ${error}`);
        return false;
    }
}

module.exports = {
    sendWhatsAppMessage,
    sendReminderMessage
};