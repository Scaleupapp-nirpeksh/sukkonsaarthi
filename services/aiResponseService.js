// services/aiResponseService.js - Service to handle general AI responses
const { createOpenAIClient } = require('../config/config');

/**
 * Get AI response for general queries
 * @param {string} userInput - User's message
 * @returns {Promise<string>} - AI-generated response
 */
async function getAIResponse(userInput) {
  try {
    const openaiClient = createOpenAIClient();
    
    // General query system message
    const systemMessage = `You are a friendly health assistant called Sukoon Saarthi. 
    You can provide general health information but should not diagnose conditions or give specific medical advice.
    Keep responses conversational, helpful, and concise for WhatsApp (under 400 words).
    Use emoji where appropriate to make the conversation friendly.`;
    
    // Call OpenAI API
    const response = await openaiClient.chat.completions.create({
      model: "gpt-3.5-turbo", // You can update to a newer model if available
      messages: [
        {
          role: "system",
          content: systemMessage
        },
        {
          role: "user",
          content: userInput
        }
      ],
      temperature: 0.7,
      max_tokens: 400 // Limit response length for WhatsApp readability
    });
    
    // Add a disclaimer for symptom-related responses
    let disclaimer = "";
    if (userInput.toLowerCase().includes('pain') || 
        userInput.toLowerCase().includes('hurt') || 
        userInput.toLowerCase().includes('ache') ||
        userInput.toLowerCase().includes('symptom') ||
        userInput.toLowerCase().includes('sick') ||
        userInput.toLowerCase().includes('ill')) {
      disclaimer = "\n\n⚠️ *Important*: This information is not a diagnosis. Always consult a healthcare provider for medical concerns.";
    }
    
    return response.choices[0].message.content + disclaimer;
  } catch (error) {
    console.error(`❌ Error getting AI response:`, error);
    return "I'm sorry, I couldn't process your request at this time. Please try again later.";
  }
}

module.exports = {
  getAIResponse
};