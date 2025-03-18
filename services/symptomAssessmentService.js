// services/symptomAssessmentService.js - Service to handle intelligent symptom assessment
const { createOpenAIClient } = require('../config/config');
const { SymptomModel } = require('../models/dbModels');

/**
 * Generate a follow-up question based on symptom information so far
 * @param {Object} symptomData - Information collected about symptoms
 * @param {number} questionNumber - Which question we're on (1-based)
 * @returns {Promise<Object>} - Next question and analysis
 */
async function getNextQuestion(symptomData, questionNumber) {
  try {
    const openaiClient = createOpenAIClient();
    
    // Create a complete symptom history from the data so far
    let symptomHistory = `Primary symptom: ${symptomData.primarySymptom}\n`;
    
    if (symptomData.answers && symptomData.answers.length > 0) {
      symptomHistory += "Answers so far:\n";
      symptomData.answers.forEach((qa, index) => {
        symptomHistory += `Q${index + 1}: ${qa.question}\nA${index + 1}: ${qa.answer}\n`;
      });
    }
    
    console.log(`📋 Symptom history for next question:\n${symptomHistory}`);
    
    // If this is the last question (question 4), generate a conclusion instead
    const isFinalQuestion = questionNumber >= 4;
    
    const prompt = isFinalQuestion ? 
      `Based on the following symptom assessment, provide a concise, clear analysis of possible causes. Be direct and brief while remaining helpful. Include only the most relevant self-care tips and when to seek medical help.

${symptomHistory}

Format your response with these sections, keeping each section brief:
- Possible explanations (2 most likely possibilities, 1-2 sentences each)
- Self-care tips (3-4 bullet points maximum)
- When to see a doctor (2-3 specific warning signs)
- Brief disclaimer

Use a reassuring tone, simple language, and avoid unnecessary details.` 
      : 
      `Based on the primary symptom and any previous answers, generate the most important follow-up question (question #${questionNumber}) to help assess this health concern.

${symptomHistory}

This should be the most relevant clinical question to ask next. Provide:
1. A single, specific follow-up question that helps narrow down potential causes
2. 2-4 structured answer options (if applicable)

Focus on duration, characteristics, associated symptoms, or aggravating/relieving factors that would be most revealing for this specific symptom.`;

    const response = await openaiClient.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a clinical decision support assistant that provides medically sound questions to gather symptom information. You never diagnose conditions but help collect relevant information for symptom assessment."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.4, // Keep consistency in question quality
      max_tokens: isFinalQuestion ? 450 : 300
    });

    const content = response.choices[0].message.content;
    
    // If it's the final question, return the assessment
    if (isFinalQuestion) {
      return {
        isAssessment: true,
        assessment: content
      };
    }
    
    // Otherwise, parse the follow-up question and options
    // Extract the main question - the first sentence
    const questionText = content.split(/\n|\.\s+/)[0].trim();
    
    // Try to find answer options (numbered or bulleted)
    const options = [];
    const optionMatches = content.match(/(\d+[\.\)]\s+[^\n]+|\-\s+[^\n]+)/g);
    
    if (optionMatches) {
      optionMatches.forEach(option => {
        const cleanOption = option.replace(/^\d+[\.\)]\s+|\-\s+/, '').trim();
        options.push(cleanOption);
      });
    }
    
    return {
      isAssessment: false,
      question: questionText,
      options: options.length > 0 ? options : null
    };
  } catch (error) {
    console.error(`❌ Error generating follow-up question: ${error}`);
    return {
      isAssessment: false,
      question: "How long have you been experiencing this symptom?",
      options: ["Less than a day", "1-3 days", "4-7 days", "More than a week"]
    };
  }
}

/**
 * Format question with answer options for messaging
 * @param {Object} questionData - Question and answer options
 * @returns {string} - Formatted message
 */
function formatQuestionMessage(questionData) {
  let message = `${questionData.question}\n\n`;
  
  if (questionData.options && questionData.options.length > 0) {
    questionData.options.forEach((option, index) => {
      message += `${index + 1}️⃣ ${option}\n`;
    });
    message += "\nPlease reply with the number of your answer.";
  } else {
    message += "Please describe in a few words.";
  }
  
  return message;
}

/**
 * Process a free-text answer or numeric selection
 * @param {string} userResponse - The user's response text
 * @param {Object} questionData - The original question data with options
 * @returns {string} - Processed answer
 */
function processAnswer(userResponse, questionData) {
  // If the response is a number and we have options, convert to the option text
  if (questionData.options && questionData.options.length > 0) {
    const numResponse = parseInt(userResponse);
    if (!isNaN(numResponse) && numResponse > 0 && numResponse <= questionData.options.length) {
      return questionData.options[numResponse - 1];
    }
  }
  
  // Otherwise, just return the original response
  return userResponse;
}

/**
 * Save a symptom assessment
 * @param {string} userPhone - User's phone number
 * @param {Object} symptomData - Symptom assessment data
 * @param {string} assessment - Final assessment text
 * @returns {Promise<string>} - Assessment ID
 */
async function saveAssessment(userPhone, symptomData, assessment) {
  try {
    return await SymptomModel.saveAssessment(userPhone, {
      primarySymptom: symptomData.primarySymptom,
      answers: symptomData.answers,
      assessment
    });
  } catch (error) {
    console.error(`❌ Error saving assessment: ${error}`);
    return null;
  }
}

/**
 * Get progression-based recommendations
 * @param {Object} assessmentData - Assessment data
 * @param {Array} followUps - Follow-up data
 * @param {string} currentStatus - Current symptom status
 * @returns {Promise<string>} - Recommendations
 */
async function getProgressionRecommendations(assessmentData, followUps, currentStatus) {
  try {
    const openaiClient = createOpenAIClient();
    
    // Create a detailed history of the symptom and follow-ups
    let symptomHistory = `Primary symptom: ${assessmentData.primarySymptom}\n`;
    
    if (assessmentData.answers && assessmentData.answers.length > 0) {
      symptomHistory += "Initial assessment details:\n";
      assessmentData.answers.forEach((qa, index) => {
        symptomHistory += `Q${index + 1}: ${qa.question}\nA${index + 1}: ${qa.answer}\n`;
      });
    }
    
    symptomHistory += "\nSymptom progression:\n";
    if (followUps && followUps.length > 0) {
      followUps.forEach((followUp, index) => {
        const date = new Date(followUp.date).toLocaleDateString();
        symptomHistory += `Day ${index + 1} (${date}): ${followUp.status}\n`;
        if (followUp.notes) {
          symptomHistory += `Notes: ${followUp.notes}\n`;
        }
      });
    }
    
    symptomHistory += `\nCurrent status: ${currentStatus}`;
    
    const prompt = `Based on this symptom progression history, provide personalized recommendations for the next steps. 
    
${symptomHistory}

If symptoms are improving, provide supportive self-care advice.
If symptoms are the same after 2-3 days, suggest more specific self-care or when to consider contacting a healthcare provider.
If symptoms are worsening, provide clear guidance on when medical attention is needed versus continued self-care.
If the user wants to complete/end follow-ups, give a brief summary of their progression.

Format your response with appropriate headings, keep it concise, and focus on practical next steps.`;

    const response = await openaiClient.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a healthcare assistant providing follow-up guidance for symptoms. Always be cautious, evidence-based, and clear about when professional medical care is needed versus self-care."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.4,
      max_tokens: 400
    });

    return response.choices[0].message.content + "\n\n⚠️ *Disclaimer*: This information is not a substitute for professional medical advice. If symptoms are severe or concerning, please consult a healthcare provider.";
  } catch (error) {
    console.error(`❌ Error generating recommendations: ${error}`);
    return "I'm having trouble analyzing your symptom progression. As a general precaution, if your symptoms persist or worsen, please consult a healthcare professional. Would you like to continue tracking these symptoms?";
  }
}

/**
 * Generate a comprehensive symptom assessment based on collected data
 * @param {Object} symptomData - Complete symptom data with answers
 * @returns {Promise<string>} - Formatted assessment
 */
async function generateFinalAssessment(symptomData) {
  try {
    // This is a wrapper around getNextQuestion to make the API clearer
    const result = await getNextQuestion(symptomData, 4); // Force final question mode
    return result.assessment;
  } catch (error) {
    console.error(`❌ Error generating final assessment: ${error}`);
    return "I'm sorry, I couldn't complete your symptom assessment at this time. If you're concerned about your symptoms, please consult a healthcare provider.";
  }
}

module.exports = {
  getNextQuestion,
  formatQuestionMessage,
  processAnswer,
  generateFinalAssessment,
  saveAssessment,
  getProgressionRecommendations
};