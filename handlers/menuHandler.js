// handlers/menuHandler.js - Logic for menu navigation
const { sendWhatsAppMessage } = require('../services/messageService');
const userService = require('../services/userService');
const medicationService = require('../services/medicationService');
const sessionStore = require('../models/sessionStore');

/**
 * Show welcome message and main menu
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function showWelcomeMenu(req, res) {
    const from = req.body.From;
    const profileName = req.body.ProfileName || "User";
    
    // Get user type
    const userDetails = await userService.getUserDetails(from);
    const userType = userDetails ? userDetails.userType : null;
    
    let welcomeMessage = `Hello ${profileName}, welcome to Sukoon Saarthi! 🌿\n`;
    
    if (userType === 'child') {
        // Get all parent accounts
        const relationships = await userService.getChildRelationships(from);
        
        if (relationships && relationships.length > 0) {
            welcomeMessage += `\nYou're managing accounts for ${relationships.length} family member(s).\n`;
            welcomeMessage += `To send commands on their behalf, start your message with "for:[their number]" followed by your command.\n`;
            welcomeMessage += `Example: "for:+917XXXXXXXX check medications"\n\n`;
        }
    }
    
    welcomeMessage += `I can assist with health tracking, symptom assessment, and medication reminders.\nType 'symptom' if you're feeling unwell or 'add medicine' to set up reminders.`;
    
    await sendWhatsAppMessage(from, welcomeMessage);
    
    // After sending the welcome message, send the menu options without sending another HTTP response
    setTimeout(async () => {
        const menuOptions = `What would you like to do today?

1️⃣ Check symptoms
2️⃣ Manage medications

Please reply with the number of your choice.`;
        
        // Set user session to main menu
        sessionStore.setUserSession(from, { 
            stage: 'main_menu'
        });
        
        await sendWhatsAppMessage(from, menuOptions);
    }, 1000); // Short delay between messages
    
    return res.status(200).send("Welcome message sent.");
}

/**
 * Show main menu without sending HTTP response
 * @param {string} from - User's phone number
 */
async function sendMainMenu(from) {
    const menuOptions = `What would you like to do today?

1️⃣ Check symptoms
2️⃣ Manage medications

Please reply with the number of your choice.`;
    
    // Set user session to main menu
    sessionStore.setUserSession(from, { 
        stage: 'main_menu'
    });
    
    await sendWhatsAppMessage(from, menuOptions);
}

/**
 * Show main menu with HTTP response
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function showMainMenu(req, res) {
    const from = req.body.From;
    await sendMainMenu(from);
    return res.status(200).send("Main menu sent.");
}

/**
 * Handle main menu selection
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleMainMenuSelection(req, res) {
    const from = req.body.From;
    const incomingMsg = req.body.Body.trim();
    const incomingMsgLower = incomingMsg.toLowerCase();
    
    // Process user's selection from the main menu
    if (incomingMsgLower === "1" || incomingMsgLower.includes("symptom") || incomingMsgLower.includes("check")) {
        // Start the symptom assessment flow
        sessionStore.setUserSession(from, { 
            type: 'symptom',
            stage: 'primary',
            answers: []
        });
        
        await sendWhatsAppMessage(from, "What symptom are you experiencing? Please describe it briefly.\n\nExamples: 'headache', 'stomach pain', 'cough', etc.");
        return res.status(200).send("Symptom assessment started.");
    }
    else if (incomingMsgLower === "2" || incomingMsgLower.includes("medication") || incomingMsgLower.includes("medicine")) {
        // Show medication management submenu
        await sendMedicationMenu(from);
        return res.status(200).send("Medication management menu sent.");
    }
    else {
        // If user sends something else, ask again
        await sendWhatsAppMessage(from, "Please select either 1 for symptoms or 2 for medications.");
        return res.status(200).send("Invalid menu selection.");
    }
}

/**
 * Send medication menu without HTTP response
 * @param {string} from - User's phone number
 */
async function sendMedicationMenu(from) {
    const medicationMenu = `*Medication Management* 💊

What would you like to do with your medications?

1️⃣ Add a new medication
2️⃣ Update existing medication
3️⃣ Delete a medication
4️⃣ View medication information
5️⃣ Check medication history (last week)
6️⃣ Check all medication history
7️⃣ Back to main menu

Please reply with the number of your choice.`;
    
    // Set user session to medication menu
    sessionStore.setUserSession(from, { 
        stage: 'medication_menu'
    });
    
    await sendWhatsAppMessage(from, medicationMenu);
}

/**
 * Show medication management menu with HTTP response
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function showMedicationMenu(req, res) {
    const from = req.body.From;
    await sendMedicationMenu(from);
    return res.status(200).send("Medication menu sent.");
}

/**
 * Handle medication menu selection
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleMedicationMenuSelection(req, res) {
    const from = req.body.From;
    const incomingMsg = req.body.Body.trim();
    const incomingMsgLower = incomingMsg.toLowerCase();
    
    // Import handlers here to avoid circular dependency
    const medicationHandler = require('./medicationHandler');
    
    // Process user's selection from the medication menu
    if (incomingMsgLower === "1" || incomingMsgLower.includes("add")) {
        // Start add medication flow
        return await medicationHandler.startAddMedication(req, res);
    }
    else if (incomingMsgLower === "2" || incomingMsgLower.includes("update")) {
        // Start update medication flow
        return await medicationHandler.startMedicationUpdate(req, res);
    }
    else if (incomingMsgLower === "3" || incomingMsgLower.includes("delete")) {
        // Start delete medication flow
        return await medicationHandler.startMedicationDeletion(req, res);
    }
    else if (incomingMsgLower === "4" || incomingMsgLower.includes("information") || incomingMsgLower.includes("info")) {
        // Show medication information options
        return await handleMedicationInfoRequest(req, res);
    }
    else if (incomingMsgLower === "5" || incomingMsgLower.includes("history") && incomingMsgLower.includes("week")) {
        // Show medication history (last week)
        return await medicationHandler.showMedicationHistory(req, res, 7);
    }
    else if (incomingMsgLower === "6" || incomingMsgLower.includes("all") && incomingMsgLower.includes("history")) {
        // Show all medication history
        return await medicationHandler.showMedicationHistory(req, res, null);
    }
    else if (incomingMsgLower === "7" || incomingMsgLower.includes("back") || incomingMsgLower.includes("main")) {
        // Return to main menu
        return await showMainMenu(req, res);
    }
    else {
        // Invalid selection - remind the user of the options
        const reminderMsg = `I'm not sure what you'd like to do with your medications. Please select one of the following options:

1️⃣ Add a new medication
2️⃣ Update existing medication
3️⃣ Delete a medication
4️⃣ View medication information
5️⃣ Check medication history (last week)
6️⃣ Check all medication history
7️⃣ Back to main menu

Please reply with the number of your choice.`;
        
        await sendWhatsAppMessage(from, reminderMsg);
        return res.status(200).send("Medication menu options reminder sent.");
    }
}

/**
 * Handle medication information request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleMedicationInfoRequest(req, res) {
    const from = req.body.From;
    
    // Get medications for the user
    const medications = await medicationService.getUserMedications(from);
    
    if (medications.length === 0) {
        await sendWhatsAppMessage(from, "You don't have any medications set up yet. Type '1' to add a medication first.");
        
        // Send the medication menu without trying to send another HTTP response
        await sendMedicationMenu(from);
        
        // Now send the HTTP response
        return res.status(200).send("No medications found, menu resent.");
    }
    
    // Create a list of medications to get info about
    let medicineList = "Which medication would you like information about?\n\n";
    medications.forEach((med, index) => {
        medicineList += `${index + 1}. ${med.medicine}\n`;
    });
    
    medicineList += "\nPlease reply with the number of your choice.";
    
    // Set user session for medication info selection
    sessionStore.setUserSession(from, { 
        stage: 'medication_info_selection',
        medications: medications
    });
    
    await sendWhatsAppMessage(from, medicineList);
    return res.status(200).send("Asked which medication to get info on.");
}

module.exports = {
    showWelcomeMenu,
    showMainMenu,
    handleMainMenuSelection,
    showMedicationMenu,
    handleMedicationMenuSelection,
    handleMedicationInfoRequest,
    sendMainMenu,     // Export the non-response functions too
    sendMedicationMenu
};