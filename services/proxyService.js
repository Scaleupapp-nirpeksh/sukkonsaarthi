// services/proxyService.js - Proxy user functionality
const { RelationshipModel, UserModel } = require('../models/dbModels');
const { sendWhatsAppMessage } = require('./messageService');
const { standardizePhoneNumber } = require('../utils/messageUtils');
const sessionStore = require('../models/sessionStore');

/**
 * Process messages sent on behalf of elderly users
 * @param {string} childPhone - Child's phone number
 * @param {string} parentPhone - Parent's phone number
 * @param {string} command - Command to process
 * @returns {Promise<Object>} - Result with success status and message
 */
async function processProxyMessage(childPhone, parentPhone, command) {
    try {
        const standardizedChild = standardizePhoneNumber(childPhone);
        const standardizedParent = standardizePhoneNumber(parentPhone);
        
        // First, check if the relationship exists
        const relationship = await RelationshipModel.getRelationship(
            standardizedChild,
            standardizedParent
        );
        
        if (!relationship) {
            return {
                success: false,
                message: `You don't have permission to manage ${parentPhone}.`
            };
        }
        
        // Check permissions
        const permissions = relationship.permissions || [];
        
        // Get parent's name
        const parentResult = await UserModel.getUserDetails(standardizedParent);
        const parentName = parentResult ? parentResult.name : "your parent";
        
        // Process different command types
        if (command.startsWith('add medicine') || command.startsWith('add medication')) {
            if (!permissions.includes('manage_medications')) {
                return {
                    success: false,
                    message: `You don't have permission to manage medications for ${parentName}.`
                };
            }
            
            // Initialize medication session for the parent
            sessionStore.medicationSessions[standardizedChild] = { 
                stage: 1,
                isProxy: true,
                targetPhone: standardizedParent
            };
            
            return {
                success: true,
                message: `I'll help you add medication for ${parentName}.\n\nPlease enter the medicine name:`,
                notifyParent: true,
                action: "started adding a medication",
                detail: "Medicine setup initiated"
            };
        }
        
        // Check medications command
        else if (command.toLowerCase().includes('check medication') || command.toLowerCase().includes('show medication')) {
            if (!permissions.includes('view_medications')) {
                return {
                    success: false,
                    message: `You don't have permission to view medications for ${parentName}.`
                };
            }
            
            // Import here to avoid circular dependency
            const medicationService = require('./medicationService');
            const medications = await medicationService.getUserMedications(standardizedParent);
            
            if (medications.length === 0) {
                return {
                    success: true,
                    message: `No medications found for ${parentName}.`,
                    notifyParent: false
                };
            }
            
            let medicationList = `Medications for ${parentName}:\n\n`;
            medications.forEach((med, index) => {
                medicationList += `${index + 1}. ${med.medicine}${med.dosage ? ` (${med.dosage})` : ''}\n` +
                                  `   Time: ${med.time}, Frequency: ${med.frequency || 'daily'}\n`;
            });
            
            return {
                success: true,
                message: medicationList,
                notifyParent: false
            };
        }
        
        // Symptom assessment command
        else if (command.toLowerCase().includes('symptom') || command.toLowerCase().includes('check health')) {
            if (!permissions.includes('view_symptoms')) {
                return {
                    success: false,
                    message: `You don't have permission to check symptoms for ${parentName}.`
                };
            }
            
            return {
                success: true,
                message: `To assess ${parentName}'s symptoms, please type "for:${parentPhone} symptom" followed by the specific symptom, e.g., "for:${parentPhone} symptom headache"`,
                notifyParent: false
            };
        }
        
        // Default response for unknown commands
        return {
            success: false,
            message: `Command not recognized. You can use commands like "add medicine" or "check medications" on behalf of ${parentName}.`
        };
    } catch (error) {
        console.error(`Error processing proxy message: ${error}`);
        return {
            success: false,
            message: "An error occurred while processing your request."
        };
    }
}

/**
 * Notify a parent about an action taken by their caregiver
 * @param {string} parentPhone - Parent's phone number
 * @param {string} childPhone - Child's phone number
 * @param {string} action - Action taken
 * @param {string} detail - Action details
 * @returns {Promise<boolean>} - Success status
 */
async function notifyParentOfProxyAction(parentPhone, childPhone, action, detail) {
    try {
        const standardizedChild = standardizePhoneNumber(childPhone);
        const standardizedParent = standardizePhoneNumber(parentPhone);
        
        // Get child user name
        const childResult = await UserModel.getUserDetails(standardizedChild);
        const childName = childResult ? childResult.name : "Your caregiver";
        
        const message = `${childName} has ${action} on your behalf: ${detail}`;
        
        await sendWhatsAppMessage(standardizedParent, message);
        return true;
    } catch (error) {
        console.error(`❌ Error notifying parent of proxy action: ${error}`);
        return false;
    }
}

module.exports = {
    processProxyMessage,
    notifyParentOfProxyAction
};