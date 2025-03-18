// handlers/accountHandler.js - Logic for account creation flows
const { sendWhatsAppMessage } = require('../services/messageService');
const userService = require('../services/userService');
const sessionStore = require('../models/sessionStore');

/**
 * Start the account creation process
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function startAccountCreation(req, res) {
    const from = req.body.From;

    // Initialize account creation session
    sessionStore.setAccountCreationSession(from, {
        stage: 'account_type',
        data: {}
    });
    
    await sendWhatsAppMessage(from, 
        `Welcome to Sukoon Saarthi! Let's create your account. Are you creating an account for:\n\n` +
        `1️⃣ Yourself (as an elderly user)\n` +
        `2️⃣ For your parent\n\n` +
        `Please reply with 1 or 2.`
    );
    
    return res.status(200).send("Account creation started");
}

/**
 * Continue the account creation process
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function continueAccountCreation(req, res) {
    const from = req.body.From;
    const incomingMsg = req.body.Body.trim();
    const incomingMsgLower = incomingMsg.toLowerCase();
    const session = sessionStore.getAccountCreationSession(from);
    
    if (!session) {
        // Invalid session state
        await sendWhatsAppMessage(from, "I'm sorry, something went wrong with your account creation. Let's start again.");
        return await startAccountCreation(req, res);
    }

    // Handle account type selection
    if (session.stage === 'account_type') {
        if (incomingMsgLower === '1' || incomingMsgLower === 'myself' || incomingMsgLower === 'self') {
            // Creating for themselves (elderly)
            session.accountType = 'self';
            session.stage = 'self_name';
            sessionStore.setAccountCreationSession(from, session);
            
            await sendWhatsAppMessage(from, "Please enter your full name:");
            return res.status(200).send("Asked for name");
        }
        else if (incomingMsgLower === '2' || incomingMsgLower === 'parent') {
            // Creating for parent
            session.accountType = 'parent';
            session.stage = 'parent_count';
            session.parents = [];
            sessionStore.setAccountCreationSession(from, session);
            
            await sendWhatsAppMessage(from, 
                `Are you creating an account for:\n\n` +
                `1️⃣ One parent\n` +
                `2️⃣ Both parents (separate accounts)\n\n` +
                `Please reply with 1 or 2.`
            );
            return res.status(200).send("Asked parent count");
        }
        else {
            await sendWhatsAppMessage(from, 
                `I didn't understand your response. Please reply with:\n\n` +
                `1️⃣ for yourself (as an elderly user)\n` +
                `2️⃣ for your parent`
            );
            return res.status(200).send("Clarified account type options");
        }
    }
    
    // SELF REGISTRATION FLOW
    // Step 1: Collect name for self
    else if (session.stage === 'self_name') {
        if (!session.data) session.data = {};
        session.data.name = incomingMsg;
        session.stage = 'self_age';
        sessionStore.setAccountCreationSession(from, session);
        
        await sendWhatsAppMessage(from, "Thank you! Please enter your age:");
        return res.status(200).send("Asked for age");
    }
    
    // Step 2: Collect age for self
    else if (session.stage === 'self_age') {
        const age = parseInt(incomingMsg);
        if (isNaN(age) || age < 1 || age > 120) {
            await sendWhatsAppMessage(from, "Please enter a valid age (a number between 1 and 120):");
            return res.status(200).send("Invalid age");
        }
        
        session.data.age = age;
        session.stage = 'self_location';
        sessionStore.setAccountCreationSession(from, session);
        
        await sendWhatsAppMessage(from, "Please enter your city and state (e.g., Mumbai, Maharashtra):");
        return res.status(200).send("Asked for location");
    }
    
    // Step 3: Collect location for self
    else if (session.stage === 'self_location') {
        session.data.location = incomingMsg;
        session.stage = 'self_emergency_contact';
        sessionStore.setAccountCreationSession(from, session);
        
        await sendWhatsAppMessage(from, "Please provide an emergency contact's WhatsApp number (with country code, e.g., +917XXXXXXXX):");
        return res.status(200).send("Asked for emergency contact");
    }
    
    // Step 4: Collect emergency contact for self
    else if (session.stage === 'self_emergency_contact') {
        // Basic validation for phone number
        const phoneRegex = /^\+\d{10,15}$/;
        if (!phoneRegex.test(incomingMsg)) {
            await sendWhatsAppMessage(from, 
                "Please enter a valid WhatsApp number with country code (e.g., +917XXXXXXXX):"
            );
            return res.status(200).send("Invalid phone number");
        }
        
        session.data.emergencyContact = incomingMsg;
        session.stage = 'self_emergency_name';
        sessionStore.setAccountCreationSession(from, session);
        
        await sendWhatsAppMessage(from, "What is the name of your emergency contact?");
        return res.status(200).send("Asked for emergency contact name");
    }
    
    // Step 5: Collect emergency contact name
    else if (session.stage === 'self_emergency_name') {
        session.data.emergencyContactName = incomingMsg;
        session.stage = 'self_emergency_relationship';
        sessionStore.setAccountCreationSession(from, session);
        
        await sendWhatsAppMessage(from, 
            "What is your relationship with the emergency contact?\n\n" +
            "For example: son, daughter, spouse, sibling, friend, etc."
        );
        return res.status(200).send("Asked for emergency relationship");
    }
    
    // Step 6: Collect relationship with emergency contact and complete self registration
    else if (session.stage === 'self_emergency_relationship') {
        session.data.emergencyRelationship = incomingMsg;
        sessionStore.setAccountCreationSession(from, session);
        
        // Create elderly user record
        const success = await userService.createUser(from, 'elderly', {
            name: session.data.name,
            age: session.data.age,
            location: session.data.location,
            emergencyContact: session.data.emergencyContact,
            emergencyContactName: session.data.emergencyContactName,
            emergencyRelationship: session.data.emergencyRelationship
        });
        
        if (success) {
            // Create relationship with emergency contact
            await userService.createRelationship(from, session.data.emergencyContact, session.data.emergencyRelationship);
            
            // Send welcome message to elderly user
            await sendWhatsAppMessage(from, 
                `✅ Thank you, ${session.data.name}! Your Sukoon Saarthi account has been created successfully.\n\n` +
                `I'll help you manage medications, track symptoms, and stay healthy.\n\n` +
                `Type "Hi" anytime to see what I can do for you.`
            );
            
            // Notify emergency contact
            await sendWhatsAppMessage(session.data.emergencyContact, 
                `Hello ${session.data.emergencyContactName},\n\n` +
                `${session.data.name} has added you as their emergency contact on Sukoon Saarthi, a healthcare assistant app.\n\n` +
                `You'll receive updates about their daily activities and medication adherence. If they need assistance, you'll be notified.\n\n` +
                `No action is needed from you right now. This is just to let you know.`
            );
            
            // Clear session
            sessionStore.deleteAccountCreationSession(from);
            
            return res.status(200).send("Elderly account created");
        } else {
            await sendWhatsAppMessage(from, "There was an error creating your account. Please try again later or contact support.");
            sessionStore.deleteAccountCreationSession(from);
            return res.status(200).send("Account creation failed");
        }
    }
    
    // PARENT REGISTRATION FLOW
    // Step 1: Determine how many parent accounts to create
    else if (session.stage === 'parent_count') {
        if (incomingMsgLower === '1' || incomingMsgLower === 'one') {
            session.parentCount = 1;
            session.currentParent = 0;
            session.stage = 'parent_phone';
            sessionStore.setAccountCreationSession(from, session);
            
            await sendWhatsAppMessage(from, "Please enter your parent's WhatsApp number (with country code, e.g., +917XXXXXXXX):");
            return res.status(200).send("Asked for parent phone");
        }
        else if (incomingMsgLower === '2' || incomingMsgLower === 'two' || incomingMsgLower === 'both') {
            session.parentCount = 2;
            session.currentParent = 0;
            session.stage = 'parent_phone';
            sessionStore.setAccountCreationSession(from, session);
            
            await sendWhatsAppMessage(from, "Please enter your first parent's WhatsApp number (with country code, e.g., +917XXXXXXXX):");
            return res.status(200).send("Asked for first parent phone");
        }
        else {
            await sendWhatsAppMessage(from, 
                `I didn't understand your response. Please reply with:\n\n` +
                `1️⃣ for one parent\n` +
                `2️⃣ for both parents`
            );
            return res.status(200).send("Clarified parent count options");
        }
    }
    
    // Step 2: Collect parent phone number
    else if (session.stage === 'parent_phone') {
        // Basic validation for phone number
        const phoneRegex = /^\+\d{10,15}$/;
        if (!phoneRegex.test(incomingMsg)) {
            await sendWhatsAppMessage(from, 
                "Please enter a valid WhatsApp number with country code (e.g., +917XXXXXXXX):"
            );
            return res.status(200).send("Invalid phone number");
        }
        
        // Check if this parent already has an account
        const parentExists = await userService.checkUserExists(incomingMsg);
        if (parentExists) {
            await sendWhatsAppMessage(from, 
                "This phone number already has an account. Please provide a different number or contact support if you believe this is an error."
            );
            return res.status(200).send("Parent already exists");
        }
        
        // Initialize parent data object if needed
        if (!session.parents[session.currentParent]) {
            session.parents[session.currentParent] = {};
        }
        
        session.parents[session.currentParent].phone = incomingMsg;
        session.stage = 'parent_name';
        sessionStore.setAccountCreationSession(from, session);
        
        let parentPosition = session.parentCount > 1 ? 
            (session.currentParent === 0 ? "first" : "second") : "";
        
        await sendWhatsAppMessage(from, `Please enter your ${parentPosition} parent's full name:`);
        return res.status(200).send("Asked for parent name");
    }
    
    // Step 3: Collect parent name
    else if (session.stage === 'parent_name') {
        session.parents[session.currentParent].name = incomingMsg;
        session.stage = 'parent_age';
        sessionStore.setAccountCreationSession(from, session);
        
        await sendWhatsAppMessage(from, `Please enter your parent's age:`);
        return res.status(200).send("Asked for parent age");
    }
    
    // Step 4: Collect parent age
    else if (session.stage === 'parent_age') {
        const age = parseInt(incomingMsg);
        if (isNaN(age) || age < 1 || age > 120) {
            await sendWhatsAppMessage(from, "Please enter a valid age (a number between 1 and 120):");
            return res.status(200).send("Invalid age");
        }
        
        session.parents[session.currentParent].age = age;
        session.stage = 'parent_location';
        sessionStore.setAccountCreationSession(from, session);
        
        await sendWhatsAppMessage(from, "Please enter your parent's city and state (e.g., Mumbai, Maharashtra):");
        return res.status(200).send("Asked for parent location");
    }
    
    // Step 5: Collect parent location
    else if (session.stage === 'parent_location') {
        session.parents[session.currentParent].location = incomingMsg;
        session.stage = 'parent_relationship';
        sessionStore.setAccountCreationSession(from, session);
        
        await sendWhatsAppMessage(from, 
            "What is your relationship with this parent?\n\n" +
            "For example: son, daughter, etc."
        );
        return res.status(200).send("Asked for relationship with parent");
    }
    
    // Step 6: Collect relationship with parent and create account
    else if (session.stage === 'parent_relationship') {
        session.parents[session.currentParent].relationship = incomingMsg;
        sessionStore.setAccountCreationSession(from, session);
        
        const currentParent = session.parents[session.currentParent];
        
        // Create parent user record
        const success = await userService.createUser(currentParent.phone, 'elderly', {
            name: currentParent.name,
            age: currentParent.age,
            location: currentParent.location,
            emergencyContact: from,
            emergencyContactName: req.body.ProfileName || "Caregiver",
            emergencyRelationship: currentParent.relationship,
            createdBy: from
        });
        
        if (success) {
            // Create relationship
            await userService.createRelationship(currentParent.phone, from, currentParent.relationship);
            
            // If this is the first parent and there are two, move to the second one
            if (session.parentCount === 2 && session.currentParent === 0) {
                session.currentParent = 1;
                session.stage = 'parent_phone';
                sessionStore.setAccountCreationSession(from, session);
                
                await sendWhatsAppMessage(from, 
                    `✅ First parent's account created successfully!\n\n` +
                    `Now, please enter your second parent's WhatsApp number (with country code, e.g., +917XXXXXXXX):`
                );
                
                // Send welcome message to the first parent
                await sendWhatsAppMessage(currentParent.phone, 
                    `Hello ${currentParent.name}, welcome to Sukoon Saarthi! 🌿\n\n` +
                    `Your account has been set up by ${req.body.ProfileName || "your caregiver"}. I'll help you manage your medications and health.\n\n` +
                    `Reply with "Hi" to get started.`
                );
                
                return res.status(200).send("First parent account created, moving to second");
            } else {
                // All parent accounts created
                let successMessage = '';
                
                if (session.parentCount === 1) {
                    successMessage = `✅ Your parent's account has been created successfully!`;
                } else {
                    successMessage = `✅ Both parent accounts have been created successfully!`;
                }
                
                await sendWhatsAppMessage(from, 
                    `${successMessage}\n\n` +
                    `You can now manage their medications and monitor their health.\n\n` +
                    `To send commands on behalf of your parent, start your message with "for:(parent's number)" followed by your command.\n\n` +
                    `For example: "for:+917XXXXXXXX add medicine..."\n\n` +
                    `Your account is also registered, and you can use Sukoon Saarthi for your own health needs. Type "Hi" to get started.`
                );
                
                // Send welcome message to the most recently added parent
                await sendWhatsAppMessage(currentParent.phone, 
                    `Hello ${currentParent.name}, welcome to Sukoon Saarthi! 🌿\n\n` +
                    `Your account has been set up by ${req.body.ProfileName || "your caregiver"}. I'll help you manage your medications and health.\n\n` +
                    `Reply with "Hi" to get started.`
                );
                
                // Create child user record if it doesn't exist
                const childExists = await userService.checkUserExists(from);
                if (!childExists) {
                    await userService.createUser(from, 'child', {
                        name: req.body.ProfileName || "Caregiver",
                        parentAccounts: session.parents.map(p => p.phone)
                    });
                }
                
                // Clear session
                sessionStore.deleteAccountCreationSession(from);
                
                return res.status(200).send("All parent accounts created");
            }
        } else {
            await sendWhatsAppMessage(from, "There was an error creating the account. Please try again later or contact support.");
            sessionStore.deleteAccountCreationSession(from);
            return res.status(200).send("Account creation failed");
        }
    }
    
    // Invalid stage
    else {
        await sendWhatsAppMessage(from, "I'm sorry, something went wrong with your account creation. Let's start again.");
        return await startAccountCreation(req, res);
    }
}

module.exports = {
    startAccountCreation,
    continueAccountCreation
};