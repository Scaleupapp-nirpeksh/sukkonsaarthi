// models/sessionStore.js - In-memory session storage

/**
 * In-memory storage for user sessions
 */
const sessionStore = {
    // Track account creation sessions
    accountCreationSessions: {},
    
    // Track user sessions for symptoms and menus
    userSessions: {},
    
    // Track medication management sessions
    medicationSessions: {},
    
    /**
     * Clean up expired sessions (can be called periodically)
     */
    cleanupExpiredSessions: function() {
        const now = Date.now();
        const EXPIRY_TIME = 30 * 60 * 1000; // 30 minutes
        
        // Add timestamp to sessions that don't have one
        Object.keys(this.accountCreationSessions).forEach(key => {
            if (!this.accountCreationSessions[key].timestamp) {
                this.accountCreationSessions[key].timestamp = now;
            }
        });
        
        Object.keys(this.userSessions).forEach(key => {
            if (!this.userSessions[key].timestamp) {
                this.userSessions[key].timestamp = now;
            }
        });
        
        Object.keys(this.medicationSessions).forEach(key => {
            if (!this.medicationSessions[key].timestamp) {
                this.medicationSessions[key].timestamp = now;
            }
        });
        
        // Remove expired sessions
        Object.keys(this.accountCreationSessions).forEach(key => {
            if (now - this.accountCreationSessions[key].timestamp > EXPIRY_TIME) {
                delete this.accountCreationSessions[key];
            }
        });
        
        Object.keys(this.userSessions).forEach(key => {
            if (now - this.userSessions[key].timestamp > EXPIRY_TIME) {
                delete this.userSessions[key];
            }
        });
        
        Object.keys(this.medicationSessions).forEach(key => {
            if (now - this.medicationSessions[key].timestamp > EXPIRY_TIME) {
                delete this.medicationSessions[key];
            }
        });
        
        console.log(`🧹 Cleaned up expired sessions. Remaining: ${Object.keys(this.accountCreationSessions).length} account creation, ${Object.keys(this.userSessions).length} user, ${Object.keys(this.medicationSessions).length} medication`);
    },
    
    /**
     * Create or update account creation session
     * @param {string} phoneNumber - User's phone number
     * @param {Object} sessionData - Session data
     */
    setAccountCreationSession: function(phoneNumber, sessionData) {
        console.log(`Setting account creation session for ${phoneNumber}`);
        this.accountCreationSessions[phoneNumber] = {
            ...sessionData,
            timestamp: Date.now()
        };
    },
    
    /**
     * Get account creation session
     * @param {string} phoneNumber - User's phone number
     * @returns {Object|null} - Session data or null if not found
     */
    getAccountCreationSession: function(phoneNumber) {
        const session = this.accountCreationSessions[phoneNumber] || null;
        console.log(`Getting account creation session for ${phoneNumber}: ${session ? 'Found' : 'Not found'}`);
        return session;
    },
    
    /**
     * Delete account creation session
     * @param {string} phoneNumber - User's phone number
     */
    deleteAccountCreationSession: function(phoneNumber) {
        console.log(`Deleting account creation session for ${phoneNumber}`);
        delete this.accountCreationSessions[phoneNumber];
    },
    
    /**
     * Create or update user session
     * @param {string} phoneNumber - User's phone number
     * @param {Object} sessionData - Session data
     */
    setUserSession: function(phoneNumber, sessionData) {
        console.log(`Setting user session for ${phoneNumber}. Type: ${sessionData.type || 'undefined'}, Stage: ${sessionData.stage || 'undefined'}`);
        this.userSessions[phoneNumber] = {
            ...sessionData,
            timestamp: Date.now()
        };
    },
    
    /**
     * Get user session
     * @param {string} phoneNumber - User's phone number
     * @returns {Object|null} - Session data or null if not found
     */
    getUserSession: function(phoneNumber) {
        const session = this.userSessions[phoneNumber] || null;
        const sessionKeys = Object.keys(this.userSessions);
        console.log(`Getting user session for ${phoneNumber}: ${session ? 'Found' : 'Not found'}`);
        if (!session && sessionKeys.length > 0) {
            console.log(`Available session keys: ${sessionKeys.join(', ')}`);
        }
        return session;
    },
    
    /**
     * Delete user session
     * @param {string} phoneNumber - User's phone number
     */
    deleteUserSession: function(phoneNumber) {
        console.log(`Deleting user session for ${phoneNumber}`);
        delete this.userSessions[phoneNumber];
    },
    
    /**
     * Create or update medication session
     * @param {string} phoneNumber - User's phone number
     * @param {Object} sessionData - Session data
     */
    setMedicationSession: function(phoneNumber, sessionData) {
        console.log(`Setting medication session for ${phoneNumber}. Stage: ${sessionData.stage || 'undefined'}`);
        this.medicationSessions[phoneNumber] = {
            ...sessionData,
            timestamp: Date.now()
        };
    },
    
    /**
     * Get medication session
     * @param {string} phoneNumber - User's phone number
     * @returns {Object|null} - Session data or null if not found
     */
    getMedicationSession: function(phoneNumber) {
        const session = this.medicationSessions[phoneNumber] || null;
        console.log(`Getting medication session for ${phoneNumber}: ${session ? 'Found' : 'Not found'}`);
        return session;
    },
    
    /**
     * Delete medication session
     * @param {string} phoneNumber - User's phone number
     */
    deleteMedicationSession: function(phoneNumber) {
        console.log(`Deleting medication session for ${phoneNumber}`);
        delete this.medicationSessions[phoneNumber];
    },
    
    /**
     * Debug function to dump all sessions
     */
    dumpSessions: function() {
        console.log("==== SESSION DUMP ====");
        console.log("Account Creation Sessions:", JSON.stringify(this.accountCreationSessions, null, 2));
        console.log("User Sessions:", JSON.stringify(this.userSessions, null, 2));
        console.log("Medication Sessions:", JSON.stringify(this.medicationSessions, null, 2));
        console.log("==== END SESSION DUMP ====");
    }
};

// Set up periodic cleanup
setInterval(() => {
    sessionStore.cleanupExpiredSessions();
}, 15 * 60 * 1000); // Run every 15 minutes

module.exports = sessionStore;