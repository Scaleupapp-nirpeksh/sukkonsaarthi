// utils/messageUtils.js - Message parsing and formatting utilities

/**
 * Standardize phone number format by removing 'whatsapp:' prefix
 * @param {string} phoneNumber - Phone number to standardize
 * @returns {string} - Standardized phone number
 */
function standardizePhoneNumber(phoneNumber) {
    // Remove 'whatsapp:' prefix if it exists
    return phoneNumber.replace('whatsapp:', '');
}

/**
 * Format phone number for WhatsApp by adding 'whatsapp:' prefix if needed
 * @param {string} phoneNumber - Phone number to format
 * @returns {string} - Formatted phone number for WhatsApp
 */
function formatWhatsAppNumber(phoneNumber) {
    return phoneNumber.startsWith('whatsapp:') ? phoneNumber : `whatsapp:${phoneNumber}`;
}

/**
 * Splits a long message into multiple chunks at appropriate breakpoints
 * @param {string} message - The message to split
 * @param {number} maxLength - Maximum length for each chunk
 * @returns {Array} - Array of message chunks
 */
function splitMessageIntoChunks(message, maxLength = 1400) {
    const chunks = [];
    
    // If the message is already short enough, return it as is
    if (message.length <= maxLength) {
        return [message];
    }
    
    // Find the best split points (preferably at paragraph breaks)
    let remainingMessage = message;
    
    while (remainingMessage.length > 0) {
        let splitIndex = maxLength;
        
        // If we need to split, try to find a natural breakpoint
        if (remainingMessage.length > maxLength) {
            // Look for paragraph breaks first
            const paragraphBreak = remainingMessage.lastIndexOf('\n\n', maxLength);
            if (paragraphBreak > maxLength / 2) {
                splitIndex = paragraphBreak + 2; // +2 to include the newlines
            } else {
                // If no paragraph break, look for line breaks
                const lineBreak = remainingMessage.lastIndexOf('\n', maxLength);
                if (lineBreak > maxLength / 2) {
                    splitIndex = lineBreak + 1; // +1 to include the newline
                } else {
                    // If no line break, look for sentence endings
                    const sentenceBreak = Math.max(
                        remainingMessage.lastIndexOf('. ', maxLength),
                        remainingMessage.lastIndexOf('! ', maxLength),
                        remainingMessage.lastIndexOf('? ', maxLength)
                    );
                    
                    if (sentenceBreak > maxLength / 2) {
                        splitIndex = sentenceBreak + 2; // +2 to include the period and space
                    } else {
                        // Last resort: look for a space to avoid splitting words
                        const spaceBreak = remainingMessage.lastIndexOf(' ', maxLength);
                        if (spaceBreak > maxLength / 2) {
                            splitIndex = spaceBreak + 1; // +1 to include the space
                        }
                        // If all else fails, split at maxLength
                    }
                }
            }
        }
        
        // Extract the chunk and add it to the array
        const chunk = remainingMessage.substring(0, splitIndex).trim();
        chunks.push(chunk);
        
        // Update the remaining message
        remainingMessage = remainingMessage.substring(splitIndex).trim();
    }
    
    return chunks;
}

/**
 * Parses a proxy command from a message
 * @param {string} message - The message to parse
 * @returns {Object|null} - Parsed command or null if not a proxy command
 */
function parseProxyCommand(message) {
    // Make the check case-insensitive by converting to lowercase
    if (!message.toLowerCase().startsWith('for:')) {
        return null;
    }
    
    try {
        // Split the message but maintain original case for the remaining part
        const firstSpace = message.indexOf(' ');
        if (firstSpace === -1) return null;
        
        const parentPhone = message.substring(4, firstSpace).trim();
        const command = message.substring(firstSpace + 1).trim();
        
        console.log(`🔄 Parsed proxy command: parentPhone=${parentPhone}, command=${command}`);
        
        return {
            parentPhone,
            command
        };
    } catch (error) {
        console.error(`❌ Error parsing proxy command: ${error}`);
        return null;
    }
}

/**
 * Format reminder message
 * @param {string} medicine - Medication name
 * @returns {string} - Formatted reminder message
 */
function formatReminderMessage(medicine) {
    return `🔔 Reminder: It's time to take your medicine - *${medicine}*. \n\nHave you taken it? ✅ Yes / ❌ No`;
}

module.exports = {
    standardizePhoneNumber,
    formatWhatsAppNumber,
    splitMessageIntoChunks,
    parseProxyCommand,
    formatReminderMessage
};