// Add a new file: utils/conversationUtils.js

/**
 * Utility for managing conversation priorities and conflicts
 */

// Define conversation types and their priority (higher number = higher priority)
const CONVERSATION_PRIORITIES = {
    'medication_reminder': 100,   // Highest priority - time-sensitive health action
    'symptom_emergency': 90,      // Emergency symptom reporting
    'check_in_response': 80,      // Check-in responses
    'symptom_assessment': 70,     // Symptom assessments
    'medication_management': 60,  // Adding/updating medications
    'account_creation': 50,       // Account setup flows
    'menu_navigation': 40,        // Menu selections
    'general_query': 10           // General questions, lowest priority
};

/**
 * Detects potential conversation conflicts for a user
 * @param {string} userPhone - User's phone number
 * @param {Object} sessionStore - The session store
 * @param {Object} activeCheckInSessions - The active check-in sessions
 * @param {function} getLatestReminder - Function to get latest medication reminder
 * @returns {Promise<Object>} - Information about active conversations
 */
async function detectConversationConflicts(userPhone, sessionStore, activeCheckInSessions, getLatestReminder) {
    const standardizedPhone = userPhone.replace('whatsapp:', '');
    
    // Get all active sessions and ongoing conversations
    const accountCreationSession = sessionStore.getAccountCreationSession(standardizedPhone);
    const userSession = sessionStore.getUserSession(standardizedPhone);
    const medicationSession = sessionStore.getMedicationSession(standardizedPhone);
    const checkInSession = activeCheckInSessions[standardizedPhone];
    const latestReminder = await getLatestReminder(standardizedPhone);
    
    // Identify all active conversation threads
    const activeConversations = [];
    
    if (accountCreationSession) {
        activeConversations.push({
            type: 'account_creation',
            priority: CONVERSATION_PRIORITIES.account_creation,
            data: accountCreationSession,
            description: `Account creation (stage: ${accountCreationSession.stage})`
        });
    }
    
    if (userSession) {
        // Determine the type based on the session
        let conversationType = 'general_query';
        let description = 'Unknown conversation';
        
        if (userSession.type === 'symptom') {
            conversationType = 'symptom_assessment';
            description = `Symptom assessment (stage: ${userSession.stage})`;
        } else if (userSession.type === 'follow_up') {
            conversationType = 'symptom_assessment';
            description = `Symptom follow-up (stage: ${userSession.stage})`;
        } else if (userSession.stage === 'main_menu' || userSession.stage === 'medication_menu') {
            conversationType = 'menu_navigation';
            description = `Menu navigation (${userSession.stage})`;
        }
        
        activeConversations.push({
            type: conversationType,
            priority: CONVERSATION_PRIORITIES[conversationType],
            data: userSession,
            description
        });
    }
    
    if (medicationSession) {
        activeConversations.push({
            type: 'medication_management',
            priority: CONVERSATION_PRIORITIES.medication_management,
            data: medicationSession,
            description: `Medication management (stage: ${medicationSession.stage})`
        });
    }
    
    if (checkInSession) {
        activeConversations.push({
            type: 'check_in_response',
            priority: CONVERSATION_PRIORITIES.check_in_response,
            data: checkInSession,
            description: `Check-in (state: ${checkInSession.conversationState})`
        });
    }
    
    if (latestReminder && !latestReminder.responded) {
        activeConversations.push({
            type: 'medication_reminder',
            priority: CONVERSATION_PRIORITIES.medication_reminder,
            data: latestReminder,
            description: `Medication reminder (${latestReminder.medicine})`
        });
    }
    
    // Sort by priority (highest first)
    activeConversations.sort((a, b) => b.priority - a.priority);
    
    // Determine if there's a conflict (multiple active conversations)
    const hasConflict = activeConversations.length > 1;
    
    return {
        hasConflict,
        activeConversations,
        highestPriority: activeConversations.length > 0 ? activeConversations[0] : null
    };
}

/**
 * Handle disambiguation when multiple conversations are active
 * @param {string} userResponse - User's text response
 * @param {Object} conflictInfo - Conflict information from detectConversationConflicts
 * @returns {Object} - Disambiguation result with action to take
 */
function handleDisambiguation(userResponse, conflictInfo) {
    const normalizedResponse = userResponse.toLowerCase().trim();
    
    // If there's no conflict, no disambiguation needed
    if (!conflictInfo.hasConflict) {
        return {
            needsDisambiguation: false,
            action: 'proceed',
            targetConversation: conflictInfo.highestPriority
        };
    }
    
    // Check if the response clearly belongs to a specific conversation
    const conversations = conflictInfo.activeConversations;
    
    // Case 1: Medication reminder responses - clear yes/no
    if (normalizedResponse === 'yes' || normalizedResponse === 'no' || 
        normalizedResponse === 'taken' || normalizedResponse === 'missed') {
        
        // Find if there's a medication reminder active
        const medicationReminder = conversations.find(conv => conv.type === 'medication_reminder');
        
        if (medicationReminder) {
            return {
                needsDisambiguation: false,
                action: 'proceed',
                targetConversation: medicationReminder
            };
        }
    }
    
    // Case 2: Numeric responses - could be menu selection or symptom assessment
    if (/^\d+$/.test(normalizedResponse)) {
        // If we have both menu and symptom active, we need to ask
        const hasMenu = conversations.some(conv => conv.type === 'menu_navigation');
        const hasSymptom = conversations.some(conv => conv.type === 'symptom_assessment');
        
        if (hasMenu && hasSymptom) {
            return {
                needsDisambiguation: true,
                action: 'ask',
                conflictType: 'menu_vs_symptom',
                options: conversations.filter(conv => 
                    conv.type === 'menu_navigation' || conv.type === 'symptom_assessment'
                )
            };
        }
    }
    
    // General case: If multiple conversations, ask for disambiguation
    return {
        needsDisambiguation: true,
        action: 'ask',
        conflictType: 'general',
        options: conversations
    };
}

/**
 * Generate a disambiguation message when multiple conversations are active
 * @param {Object} disambiguationInfo - Disambiguation information
 * @returns {string} - Message to send to user
 */
function generateDisambiguationMessage(disambiguationInfo) {
    if (disambiguationInfo.conflictType === 'menu_vs_symptom') {
        return "I noticed you sent a number, but you have both a menu selection and a symptom assessment in progress. What are you responding to?\n\n" +
               "1. Menu selection\n" +
               "2. Symptom assessment\n\n" +
               "Please reply with 1 or 2.";
    }
    
    // General case
    let message = "I noticed you have multiple conversations active. What are you responding to?\n\n";
    
    disambiguationInfo.options.forEach((conv, index) => {
        message += `${index + 1}. ${conv.description}\n`;
    });
    
    message += "\nPlease reply with the number of your choice.";
    
    return message;
}

module.exports = {
    CONVERSATION_PRIORITIES,
    detectConversationConflicts,  // This function should be exported
    handleDisambiguation,
    generateDisambiguationMessage
};