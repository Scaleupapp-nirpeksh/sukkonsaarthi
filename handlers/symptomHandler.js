// handlers/symptomHandler.js - Logic for symptom assessment flows
const symptomAssessmentService = require('../services/symptomAssessmentService');
const { sendWhatsAppMessage } = require('../services/messageService');
const sessionStore = require('../models/sessionStore');
const menuHandler = require('./menuHandler');
const { SymptomModel } = require('../models/dbModels');
const { standardizePhoneNumber } = require('../utils/messageUtils');

/**
 * Start a new symptom assessment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function startSymptomAssessment(req, res) {
    const from = req.body.From;
    
    // Initialize a new symptom session
    sessionStore.setUserSession(from, { 
        type: 'symptom',
        stage: 'primary',
        answers: []
    });
    
    await sendWhatsAppMessage(from, "What symptom are you experiencing? Please describe it briefly.\n\nExamples: 'headache', 'stomach pain', 'cough', etc.");
    return res.status(200).send("Symptom assessment started.");
}

/**
 * Continue an ongoing symptom assessment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function continueSymptomAssessment(req, res) {
    const from = req.body.From;
    const incomingMsg = req.body.Body.trim();
    const userSession = sessionStore.getUserSession(from);
    
    if (!userSession || userSession.type !== 'symptom') {
        // Invalid session state
        await sendWhatsAppMessage(from, "I'm sorry, something went wrong with your symptom assessment. Let's start again.");
        return await startSymptomAssessment(req, res);
    }
    
    if (userSession.stage === 'primary') {
        // Process primary symptom and start follow-up questions
        userSession.primarySymptom = incomingMsg;
        userSession.stage = 'follow_up';
        userSession.questionNumber = 1;
        
        console.log(`🩺 Primary symptom recorded: ${incomingMsg}`);
        
        // Generate the first follow-up question
        const questionData = await symptomAssessmentService.getNextQuestion(
            {
                primarySymptom: incomingMsg,
                answers: []
            }, 
            1
        );
        
        // Store the current question for later reference
        userSession.currentQuestion = questionData;
        sessionStore.setUserSession(from, userSession);
        
        // Format and send the question
        const formattedQuestion = symptomAssessmentService.formatQuestionMessage(questionData);
        await sendWhatsAppMessage(from, formattedQuestion);
        
        return res.status(200).send("First follow-up question sent.");
    } 
    else if (userSession.stage === 'follow_up') {
        // Process follow-up questions and generate next questions or assessment
        // Process the user's answer to the current question
        const processedAnswer = symptomAssessmentService.processAnswer(
            incomingMsg, 
            userSession.currentQuestion
        );
        
        // Store the Q&A pair
        if (!userSession.answers) userSession.answers = [];
        
        userSession.answers.push({
            question: userSession.currentQuestion.question,
            answer: processedAnswer
        });
        
        console.log(`📝 Recorded answer to question ${userSession.questionNumber}: ${processedAnswer}`);
        
        // Increment question counter
        userSession.questionNumber += 1;
        
        // Get the next question or final assessment
        const nextQuestionData = await symptomAssessmentService.getNextQuestion(
            {
                primarySymptom: userSession.primarySymptom,
                answers: userSession.answers
            },
            userSession.questionNumber
        );
        
        // If this is the final assessment
        if (nextQuestionData.isAssessment) {
            console.log(`✅ Symptom assessment completed for ${from}`);
            
            // Save the assessment to the database
            const standardizedPhone = standardizePhoneNumber(from);
            const assessmentId = await symptomAssessmentService.saveAssessment(
                standardizedPhone,
                {
                    primarySymptom: userSession.primarySymptom,
                    answers: userSession.answers
                },
                nextQuestionData.assessment
            );
            
            // Send the assessment
            await sendWhatsAppMessage(from, nextQuestionData.assessment);
            
            // Notify about follow-up if the assessment was saved successfully
            if (assessmentId) {
                await sendWhatsAppMessage(from, 
                    "I'll check in with you tomorrow to see how your symptoms are progressing. " +
                    "I'll provide updated recommendations based on whether you're feeling better, the same, or worse."
                );
            }
            
            // Clean up session
            sessionStore.deleteUserSession(from);
            
            setTimeout(async () => {
                await menuHandler.sendMainMenu(from);
            }, 2000);
            
            return res.status(200).send("Assessment sent.");
        }
        
        // Otherwise, continue with the next question
        userSession.currentQuestion = nextQuestionData;
        sessionStore.setUserSession(from, userSession);
        
        // Format and send the next question
        const formattedQuestion = symptomAssessmentService.formatQuestionMessage(nextQuestionData);
        await sendWhatsAppMessage(from, formattedQuestion);
        
        return res.status(200).send(`Follow-up question ${userSession.questionNumber} sent.`);
    }
    
    // If we get here, something is wrong with the session state
    await sendWhatsAppMessage(from, "I'm sorry, something went wrong with your symptom assessment. Let's start again.");
    return await startSymptomAssessment(req, res);
}

/**
 * Show the user's symptom history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function showSymptomHistory(req, res) {
    const from = req.body.From;
    const standardizedPhone = standardizePhoneNumber(from);
    
    try {
        // Get active and recent assessments
        const activeAssessments = await SymptomModel.getActiveAssessments(standardizedPhone);
        
        if (activeAssessments.length === 0) {
            await sendWhatsAppMessage(from, 
                "You don't have any active symptom assessments. If you're experiencing symptoms, " +
                "you can start a new assessment by typing 'symptom'."
            );
            
            setTimeout(async () => {
                await menuHandler.sendMainMenu(from);
            }, 2000);
            
            return res.status(200).send("No active assessments.");
        }
        
        // Format the assessments for display
        let historyMessage = "📊 *Your Symptom History*\n\n";
        
        activeAssessments.forEach((assessment, index) => {
            const createdDate = new Date(assessment.createdAt).toLocaleDateString();
            const dayCount = assessment.followUps ? assessment.followUps.length : 0;
            
            historyMessage += `*${index + 1}. ${assessment.primarySymptom}*\n`;
            historyMessage += `Started: ${createdDate}\n`;
            historyMessage += `Days tracked: ${dayCount + 1}\n`;
            
            // Show latest status if available
            if (assessment.followUps && assessment.followUps.length > 0) {
                const latestFollowUp = assessment.followUps[assessment.followUps.length - 1];
                historyMessage += `Latest status: ${latestFollowUp.status}\n`;
            }
            
            historyMessage += `\n`;
        });
        
        historyMessage += "To update your symptom status, type 'check symptom status'.";
        
        await sendWhatsAppMessage(from, historyMessage);
        
        setTimeout(async () => {
            await menuHandler.sendMainMenu(from);
        }, 2000);
        
        return res.status(200).send("Symptom history sent.");
    } catch (error) {
        console.error(`❌ Error showing symptom history: ${error}`);
        await sendWhatsAppMessage(from, "I'm sorry, I couldn't retrieve your symptom history right now. Please try again later.");
        
        setTimeout(async () => {
            await menuHandler.sendMainMenu(from);
        }, 2000);
        
        return res.status(200).send("Error showing symptom history.");
    }
}

module.exports = {
    startSymptomAssessment,
    continueSymptomAssessment,
    showSymptomHistory
};