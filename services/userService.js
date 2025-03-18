// services/userService.js - User account management
const { UserModel, RelationshipModel } = require('../models/dbModels');
const { sendWhatsAppMessage } = require('./messageService');
const { standardizePhoneNumber } = require('../utils/messageUtils');

/**
 * Create a new user account
 * @param {string} phoneNumber - User's phone number
 * @param {string} userType - Type of user (elderly or child)
 * @param {Object} userData - User data to save
 * @returns {Promise<boolean>} - Success status
 */
async function createUser(phoneNumber, userType, userData) {
    const standardizedPhone = standardizePhoneNumber(phoneNumber);
    return await UserModel.createUser(standardizedPhone, userType, userData);
}

/**
 * Check if a user exists
 * @param {string} phoneNumber - User's phone number
 * @returns {Promise<boolean>} - Whether the user exists
 */
async function checkUserExists(phoneNumber) {
    const standardizedPhone = standardizePhoneNumber(phoneNumber);
    return await UserModel.checkUserExists(standardizedPhone);
}

/**
 * Get user details
 * @param {string} phoneNumber - User's phone number
 * @returns {Promise<Object|null>} - User details or null if not found
 */
async function getUserDetails(phoneNumber) {
    const standardizedPhone = standardizePhoneNumber(phoneNumber);
    return await UserModel.getUserDetails(standardizedPhone);
}

/**
 * Create a relationship between parent and child
 * @param {string} parentPhone - Parent's phone number
 * @param {string} childPhone - Child's phone number
 * @param {string} relationshipType - Type of relationship
 * @returns {Promise<boolean>} - Success status
 */
async function createRelationship(parentPhone, childPhone, relationshipType) {
    const standardizedParent = standardizePhoneNumber(parentPhone);
    const standardizedChild = standardizePhoneNumber(childPhone);
    
    return await RelationshipModel.createRelationship(
        standardizedParent,
        standardizedChild,
        relationshipType
    );
}

/**
 * Get all parent-child relationships for a child
 * @param {string} childPhone - Child's phone number
 * @returns {Promise<Array>} - Array of relationships
 */
async function getChildRelationships(childPhone) {
    const standardizedChild = standardizePhoneNumber(childPhone);
    return await RelationshipModel.getChildRelationships(standardizedChild);
}

/**
 * Check if a child has permission to manage a parent
 * @param {string} childPhone - Child's phone number
 * @param {string} parentPhone - Parent's phone number
 * @param {string} permission - Permission to check
 * @returns {Promise<boolean>} - Whether the child has permission
 */
async function hasPermission(childPhone, parentPhone, permission) {
    const standardizedChild = standardizePhoneNumber(childPhone);
    const standardizedParent = standardizePhoneNumber(parentPhone);
    
    const relationship = await RelationshipModel.getRelationship(
        standardizedChild,
        standardizedParent
    );
    
    if (!relationship) {
        return false;
    }
    
    const permissions = relationship.permissions || [];
    return permissions.includes(permission);
}

/**
 * Complete the user account creation process
 * @param {string} phoneNumber - User's phone number
 * @param {string} userType - Type of user (elderly or child)
 * @param {Object} userData - User data
 * @param {Object} options - Additional options
 * @returns {Promise<boolean>} - Success status
 */
async function completeUserCreation(phoneNumber, userType, userData, options = {}) {
    try {
        const success = await createUser(phoneNumber, userType, userData);
        
        if (!success) {
            return false;
        }
        
        // Handle emergency contact notification if provided
        if (userData.emergencyContact) {
            const emergencyMessage = `Hello ${userData.emergencyContactName},

${userData.name} has added you as their emergency contact on Sukoon Saarthi, a healthcare assistant app.

You'll receive updates about their daily activities and medication adherence. If they need assistance, you'll be notified.

No action is needed from you right now. This is just to let you know.`;

            await sendWhatsAppMessage(userData.emergencyContact, emergencyMessage);
        }
        
        // Send welcome message to the new user
        const welcomeMessage = `✅ Thank you, ${userData.name}! Your Sukoon Saarthi account has been created successfully.

I'll help you manage medications, track symptoms, and stay healthy.

Type "Hi" anytime to see what I can do for you.`;

        await sendWhatsAppMessage(phoneNumber, welcomeMessage);
        
        return true;
    } catch (error) {
        console.error(`❌ Error completing user creation: ${error}`);
        return false;
    }
}

module.exports = {
    createUser,
    checkUserExists,
    getUserDetails,
    createRelationship,
    getChildRelationships,
    hasPermission,
    completeUserCreation
};