// services/checkInService.js - Service for AI-driven check-ins with elderly users
const { createOpenAIClient } = require('../config/config');
const { sendWhatsAppMessage } = require('./messageService');
const { DB_TABLES, dynamoDB } = require('../config/config');
const { CheckInModel, ReportModel, UserModel, RelationshipModel } = require('../models/dbModels');
const userService = require('./userService');
const { standardizePhoneNumber } = require('../utils/messageUtils');
const { MedicationModel } = require('../models/dbModels');
const { formatDate } = require('../utils/timeUtils');


// Track ongoing check-in conversations
const activeCheckInSessions = {};

/**
 * Schedule for check-in times throughout the day
 * Randomized within each window to seem more natural
 */
const CHECK_IN_SCHEDULE = [
  { name: 'morning', baseHour: 9, varianceMinutes: 30 },  // Morning: 9:00-9:30am
  { name: 'midday', baseHour: 13, varianceMinutes: 60 },  // Midday: 1:00-2:00pm
  { name: 'evening', baseHour: 21, varianceMinutes: 20 }  // Evening: 4:00-6:45pm
];

/**
 * Initialize the check-in scheduler for all elderly users
 */
function initializeCheckInScheduler() {
  console.log('🔄 Initializing check-in scheduler');
  
  // Schedule each check-in time
  CHECK_IN_SCHEDULE.forEach((timeSlot, index) => {
    scheduleNextCheckIn(index);
  });
  
  console.log('✅ Check-in scheduler initialized');
}

/**
 * Schedule the next check-in for a specific time slot
 * @param {number} timeSlotIndex - Index in the CHECK_IN_SCHEDULE array
 */
function scheduleNextCheckIn(timeSlotIndex) {
  const now = new Date();
  const settings = CHECK_IN_SCHEDULE[timeSlotIndex];
  
  // Calculate target time with randomized variance
  const targetTime = new Date();
  targetTime.setHours(settings.baseHour, 0, 0, 0);
  
  // Add random variance to make timing feel natural
  const varianceMs = Math.floor(Math.random() * settings.varianceMinutes * 60 * 1000);
  targetTime.setTime(targetTime.getTime() + varianceMs);
  
  // If target time has already passed today, schedule for tomorrow
  if (targetTime <= now) {
    targetTime.setDate(targetTime.getDate() + 1);
  }
  
  // Calculate delay in milliseconds
  const delayMs = targetTime.getTime() - now.getTime();
  
  console.log(`🕒 Scheduling ${settings.name} check-in for ${targetTime.toLocaleString()} (in ${Math.round(delayMs/60000)} minutes)`);
  
  // Schedule the check-in
  setTimeout(async () => {
    // Execute the check-in
    await executeScheduledCheckIn(timeSlotIndex);
    
    // Schedule the next check-in for this time slot
    scheduleNextCheckIn(timeSlotIndex);
  }, delayMs);
}

/**
 * Execute scheduled check-ins for all elderly users
 * @param {number} timeSlotIndex - Index in the CHECK_IN_SCHEDULE array
 */
async function executeScheduledCheckIn(timeSlotIndex) {
  try {
    const timeSlot = CHECK_IN_SCHEDULE[timeSlotIndex];
    console.log(`🔔 Executing ${timeSlot.name} check-ins`);
    
    // Get all elderly users from the database
    const params = {
      TableName: DB_TABLES.USERS_TABLE,
      FilterExpression: "userType = :type",
      ExpressionAttributeValues: {
        ":type": "elderly"
      }
    };
    
    const result = await dynamoDB.scan(params).promise();
    const elderlyUsers = result.Items || [];
    
    console.log(`📋 Found ${elderlyUsers.length} elderly users for check-ins`);
    
    // Send check-ins to each user with a slight delay between them
    for (const user of elderlyUsers) {
      // Skip users who opted out of check-ins
      if (user.checkInsOptOut) {
        console.log(`⏭️ User ${user.phoneNumber} has opted out of check-ins`);
        continue;
      }
      
      // Generate and send check-in question
      const checkInMessage = await generateCheckInQuestion(user.phoneNumber, timeSlot.name);
      await sendWhatsAppMessage(user.phoneNumber, checkInMessage);
      
      // Track the active check-in session
      activeCheckInSessions[user.phoneNumber] = {
        timeSlot: timeSlot.name,
        question: checkInMessage,
        timestamp: new Date().toISOString(),
        conversationState: 'initial', // Track conversation state: 'initial', 'follow_up_1', 'follow_up_2'
        conversationHistory: [{ role: 'assistant', content: checkInMessage }] // Initialize conversation history
      };
      
      console.log(`✅ Sent ${timeSlot.name} check-in to ${user.phoneNumber}`);
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.error(`❌ Error executing check-ins: ${error}`);
  }
}

/**
 * Generate a personalized check-in question with more variety
 * @param {string} userId - User's phone number
 * @param {string} timeSlot - Time of day (morning/midday/evening)
 * @returns {Promise<string>} - Generated check-in question
 */
async function generateCheckInQuestion(userId, timeSlot) {
  try {
    const openaiClient = createOpenAIClient();
    
    // Get user data and previous check-ins
    const userData = await UserModel.getUserDetails(userId);
    const recentCheckIns = await CheckInModel.getRecentCheckIns(userId, 5);
    
    // Create context from recent check-ins
    let checkInContext = "";
    let recentTopics = [];
    
    if (recentCheckIns.length > 0) {
      checkInContext = "Recent interactions:\n";
      recentCheckIns.forEach((checkIn, index) => {
        checkInContext += `${index + 1}. Q: ${checkIn.question}\n   A: ${checkIn.response || "No response"}\n`;
        
        // Extract topics from previous questions to avoid repetition
        const questionWords = checkIn.question.toLowerCase().split(/\s+/);
        const topicWords = questionWords.filter(word => 
          word.length > 4 && 
          !['hello', 'there', 'today', 'doing', 'feeling', 'going', 'about', 'would', 'morning', 'afternoon', 'evening'].includes(word)
        );
        recentTopics = [...recentTopics, ...topicWords];
      });
    }
    
    // Get user's activities and preferences if available
    const userInterests = userData?.interests || [];
    const userActivities = userData?.activities || [];
    const userHealth = userData?.healthConditions || [];
    
    const prompt = `Generate a unique, personalized check-in message for an elderly person that includes a natural follow-up question. Make this feel like a genuine, caring text from a friend or family member.
  
User details:
- Name: ${userData?.name || "there"}
- Age: ${userData?.age || "elderly"}
- Location: ${userData?.location || "unknown"}
${userInterests.length > 0 ? `- Interests: ${userInterests.join(', ')}` : ''}
${userActivities.length > 0 ? `- Regular activities: ${userActivities.join(', ')}` : ''}
${userHealth.length > 0 ? `- Health conditions: ${userHealth.join(', ')}` : ''}
  
Current time slot: ${timeSlot} (But don't explicitly mention this time period - make it natural)
Current season: ${getCurrentSeason()}
Recent conversation topics to avoid: ${recentTopics.join(', ')}
  
${checkInContext}
  
Guidelines:
1. Be creative and unpredictable - don't follow an obvious pattern of questions
2. Use a warm, friendly tone with natural language 
3. Keep it brief (2-3 sentences maximum)
4. Include their name and an appropriate emoji
5. Make your question feel spontaneous and genuine
6. Be specific rather than generic when possible
7. Include ONE brief follow-up question that helps gauge their wellbeing or activities
8. Occasionally share a small personal observation to feel more human
9. Avoid repetitive check-in patterns

Examples of good, varied check-in starters with follow-ups:
- "Hi Sarah! I was just thinking about that garden you mentioned. Have your tomatoes started growing yet? How's your energy been while tending to them? 🌱"
- "Good day Raj! This weather reminds me of perfect chai time. Have you tried any new tea flavors lately? How are your morning walks going? ☕"
- "Hello Maria! Just wondering if you managed to finish that book you mentioned last week? Did you find it as enjoyable as you hoped? 📚"`;

    // Generate the check-in message
    const response = await openaiClient.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a caring companion who checks in on elderly people. Your messages are warm, personal, varied, and conversational. You avoid sounding like an automated check-in service by being unpredictable and specific."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.8, // Higher temperature for more creativity
      max_tokens: 150
    });
    
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error(`❌ Error generating check-in question: ${error}`);
    // Fallback message if AI generation fails
    return `Hello ${userData?.name || "there"}! How are you feeling today? I'd love to hear about your day so far. 😊`;
  }
}

/**
 * Helper function to get current season
 * @returns {string} - Current season name
 */
function getCurrentSeason() {
  const now = new Date();
  const month = now.getMonth() + 1;
  
  // Northern hemisphere seasons
  if (month >= 3 && month <= 5) return "Spring";
  if (month >= 6 && month <= 8) return "Summer";
  if (month >= 9 && month <= 11) return "Fall";
  return "Winter";
}

/**
 * Process a response to a check-in
 * @param {string} userId - User's phone number
 * @param {string} response - User's response text
 * @returns {Promise<Object>} - Processing result
 */
async function processCheckInResponse(userId, response) {
  try {
    const standardizedUserId = standardizePhoneNumber(userId);
    
    // Check if there's an active check-in session
    if (!activeCheckInSessions[standardizedUserId]) {
      console.log(`No active check-in session found for ${standardizedUserId}`);
      return {
        success: false,
        message: "No active check-in session found."
      };
    }
    
    const session = activeCheckInSessions[standardizedUserId];
    
    // Initialize conversation state if this is the first response
    if (!session.conversationState) {
      session.conversationState = 'initial';
    }
    
    console.log(`Found active ${session.timeSlot} check-in session for ${standardizedUserId} in state: ${session.conversationState}`);
    
    // Add user response to conversation history
    if (!session.conversationHistory) {
      session.conversationHistory = [];
    }
    
    session.conversationHistory.push({
      role: 'user',
      content: response
    });
    
    // If this is the initial response, analyze it and decide if follow-up is needed
    if (session.conversationState === 'initial') {
      // Analyze the response
      const analysis = await analyzeCheckInResponse(response, session.question);
      
      // Store analysis for later use when finalizing the check-in
      session.initialAnalysis = analysis;
      
      // Determine if we need follow-up questions based on the analysis
      const needsFollowUp = determineIfFollowUpNeeded(analysis);
      
      if (needsFollowUp) {
        // Generate a follow-up question
        const followUpQuestion = await generateFollowUpQuestion(standardizedUserId, response, analysis);
        
        // Update session state
        session.conversationState = 'follow_up_1';
        session.conversationHistory.push({
          role: 'assistant',
          content: followUpQuestion
        });
        
        // Send the follow-up question
        return {
          success: true,
          followUp: followUpQuestion,
          conversationComplete: false
        };
      } else {
        // No follow-up needed, finalize the check-in
        return await finalizeCheckIn(standardizedUserId, session, analysis);
      }
    }
    // Handle first follow-up response
    else if (session.conversationState === 'follow_up_1') {
      // Analyze the combined conversation to get a more complete picture
      const combinedAnalysis = await analyzeConversation(session.conversationHistory, session.initialAnalysis);
      
      // Determine if we need a second follow-up
      const needsSecondFollowUp = determineIfSecondFollowUpNeeded(combinedAnalysis, session.conversationHistory);
      
      if (needsSecondFollowUp) {
        // Generate second follow-up question
        const secondFollowUp = await generateSecondFollowUpQuestion(standardizedUserId, combinedAnalysis);
        
        // Update session state
        session.conversationState = 'follow_up_2';
        session.conversationHistory.push({
          role: 'assistant',
          content: secondFollowUp
        });
        
        return {
          success: true,
          followUp: secondFollowUp,
          conversationComplete: false
        };
      } else {
        // No second follow-up needed, finalize the check-in
        return await finalizeCheckIn(standardizedUserId, session, combinedAnalysis);
      }
    }
    // Handle second follow-up response and finalize
    else if (session.conversationState === 'follow_up_2') {
      // Final analysis of the complete conversation
      const finalAnalysis = await analyzeConversation(session.conversationHistory, session.initialAnalysis);
      
      // Finalize the check-in
      return await finalizeCheckIn(standardizedUserId, session, finalAnalysis);
    }
    // If we reach here, something is wrong with the session state
    else {
      console.error(`Invalid conversation state: ${session.conversationState}`);
      return {
        success: false,
        message: "Error processing check-in response."
      };
    }
  } catch (error) {
    console.error(`❌ Error processing check-in response: ${error}`);
    return {
      success: false,
      message: "Error processing your response."
    };
  }
}

/**
 * Analyze a check-in response to extract information
 * @param {string} response - User's response text
 * @param {string} question - Original question asked
 * @returns {Promise<Object>} - Analysis results
 */
async function analyzeCheckInResponse(response, question) {
  try {
    const openaiClient = createOpenAIClient();
    
    const prompt = `Analyze this elderly person's response to a check-in question.

Question: ${question}
Response: ${response}

Please extract and categorize the following information:
1. Overall sentiment (positive, neutral, negative)
2. Activities mentioned (list specific activities)
3. Wellbeing indicators (physical, emotional, social)
4. Any concerns or issues that might need attention

Format the response as a JSON object with these fields:
- sentiment: string (positive, neutral, or negative)
- activities: array of strings
- wellbeing: object with physical, emotional, and social properties (each rated as good, fair, or concerning)
- concerns: array of strings`;

    const aiResponse = await openaiClient.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are an analytical assistant that extracts structured information from text. Respond only with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 400,
      response_format: { type: "json_object" }
    });
    
    // Parse the JSON response
    return JSON.parse(aiResponse.choices[0].message.content);
  } catch (error) {
    console.error(`❌ Error analyzing check-in response: ${error}`);
    
    // Default analysis if AI fails
    return {
      sentiment: "neutral",
      activities: [],
      wellbeing: {
        physical: "fair",
        emotional: "fair",
        social: "fair"
      },
      concerns: []
    };
  }
}

/**
 * Generate a follow-up response to the user
 * @param {string} userId - User's phone number
 * @param {string} userResponse - User's response text
 * @param {Object} analysis - Analysis of the response
 * @returns {Promise<string>} - Follow-up response
 */
async function generateFollowUpResponse(userId, userResponse, analysis) {
  try {
    const openaiClient = createOpenAIClient();
    
    // Get user details
    const userData = await UserModel.getUserDetails(userId);
    
    const prompt = `Generate a brief, warm follow-up response to an elderly person's check-in.

User's name: ${userData?.name || "Friend"}
Their response: ${userResponse}

Analysis of their response:
- Sentiment: ${analysis.sentiment}
- Activities mentioned: ${analysis.activities.join(', ')}
- Wellbeing: Physical (${analysis.wellbeing.physical}), Emotional (${analysis.wellbeing.emotional}), Social (${analysis.wellbeing.social})
- Concerns: ${analysis.concerns.join(', ')}

Guidelines for your response:
- Be warm, empathetic, and supportive
- Acknowledge something specific from their response
- Keep it brief (1-2 sentences)
- Include their name
- Add an appropriate emoji
- Don't ask follow-up questions that require a response

Your response should feel like a natural conclusion to the conversation.`;

    const response = await openaiClient.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a caring companion who checks in on elderly people. Your responses are warm, specific, and brief."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 150
    });
    
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error(`❌ Error generating follow-up response: ${error}`);
    return "Thank you for sharing that with me. I appreciate you taking the time to respond. 😊";
  }
}

/**
 * Generate and send daily reports to caregivers
 */
async function sendDailyReports() {
  try {
    console.log('📊 Generating daily reports');
    
    // Get all caregiver relationships
    const relationships = await RelationshipModel.getAllRelationships();
    
    // Group by caregiver
    const caregiverMap = {};
    relationships.forEach(rel => {
      if (!caregiverMap[rel.childPhone]) {
        caregiverMap[rel.childPhone] = [];
      }
      caregiverMap[rel.childPhone].push(rel.parentPhone);
    });
    
    console.log(`Found ${Object.keys(caregiverMap).length} caregivers with elderly relationships`);
    
    // For each caregiver, generate reports for all their elderly
    for (const [caregiverId, elderlyIds] of Object.entries(caregiverMap)) {
      for (const elderlyId of elderlyIds) {
        const report = await generateDailyReport(elderlyId);
        
        // Generate a unique report ID
        const reportId = `${caregiverId}_${elderlyId}_${new Date().toISOString().split('T')[0]}`;
        
        // Get today's check-ins to mark as reported
        const todaysCheckIns = await CheckInModel.getTodaysCheckIns(elderlyId);
        const checkInIds = todaysCheckIns.map(checkIn => checkIn.checkInId);
        
        // Save report to database
        const reportData = {
          reportId: reportId,
          elderlyId: elderlyId,
          caregiverId: caregiverId,
          date: new Date().toISOString().split('T')[0],
          content: report,
          checkInIds: checkInIds,
          sentTimestamp: new Date().toISOString(),
          delivered: false
        };
        
        await ReportModel.saveReport(reportData);
        
        // Mark check-ins as reported
        if (checkInIds.length > 0) {
          await CheckInModel.markCheckInsAsReported(checkInIds, reportId);
        }
        
        // Send report to caregiver
        await sendWhatsAppMessage(caregiverId, report);
        console.log(`✅ Sent daily report to ${caregiverId} for ${elderlyId}`);
        
        // Add a delay between sends to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('✅ Daily reports completed');
  } catch (error) {
    console.error(`❌ Error sending daily reports: ${error}`);
  }
}

/**
 * Generate a daily report for one elderly user that includes check-in data and a medication summary.
 * @param {string} elderlyUserId - Elderly user's phone number
 * @returns {Promise<string>} - Formatted report
 */
async function generateDailyReport(elderlyUserId) {
    try {
      const standardizedUserId = standardizePhoneNumber(elderlyUserId);
      
      // Get elderly user details
      const elderlyUserData = await UserModel.getUserDetails(standardizedUserId);
      
      // Get today's check-ins using the model
      const todaysCheckIns = await CheckInModel.getTodaysCheckIns(standardizedUserId);
      
      // Get today's medication summary for the user
      const medicationSummary = await getMedicationSummary(standardizedUserId);
      
      // If no check-ins, return a simple report including the medication summary
      if (todaysCheckIns.length === 0) {
        return `*Daily Report for ${elderlyUserData.name}*\n\nNo check-ins were recorded today. This could mean they were away or did not respond to the check-in messages.\n\n${medicationSummary}`;
      }
      
      // Generate the full report using AI, incorporating both check-in details and medication summary
      return await formatDailyReport(elderlyUserData, todaysCheckIns, medicationSummary);
    } catch (error) {
      console.error(`❌ Error generating daily report: ${error}`);
      return "Error generating daily report. Please try again later.";
    }
  }
  
  /**
   * Format a daily report using AI by combining check-in details with medication summary.
   * @param {Object} elderlyUserData - Elderly user details
   * @param {Array} checkIns - Today's check-ins
   * @param {string} medicationSummary - Today's medication summary
   * @returns {Promise<string>} - Formatted report
   */
  async function formatDailyReport(elderlyUserData, checkIns, medicationSummary) {
    try {
      const openaiClient = createOpenAIClient();
      
      // Format check-ins for the prompt
      let checkInsText = "";
      checkIns.forEach((checkIn, index) => {
        const time = new Date(checkIn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let checkInData = `Check-in ${index + 1} (${time}):\n`;
        
        if (checkIn.fullConversation && checkIn.fullConversation.length > 0) {
          checkInData += "Conversation:\n";
          checkIn.fullConversation.forEach(msg => {
            checkInData += `${msg.role === 'user' ? 'Elderly' : 'Assistant'}: ${msg.content}\n`;
          });
        } else {
          checkInData += `Q: ${checkIn.question}\nA: ${checkIn.response || "No response"}\n`;
        }
        
        checkInData += `Sentiment: ${checkIn.sentiment}\n`;
        checkInData += `Activities: ${checkIn.activities?.join(', ') || "None mentioned"}\n`;
        checkInData += `Wellbeing: Physical (${checkIn.wellbeing?.physical}), Emotional (${checkIn.wellbeing?.emotional}), Social (${checkIn.wellbeing?.social})\n`;
        checkInData += `Concerns: ${checkIn.concerns?.join(', ') || "None identified"}\n\n`;
        
        checkInsText += checkInData;
      });
      
      // Create a prompt that includes both the check-in details and medication summary
      const prompt = `Generate a daily activity report for a caregiver about their elderly family member.
  
  Elderly person: ${elderlyUserData.name} (${elderlyUserData.age || "elderly"})
  Date: ${new Date().toLocaleDateString()}
  
  Today's check-ins:
  ${checkInsText}
  
  Medication Summary:
  ${medicationSummary}
  
  Create a concise, informative daily report that:
  1. Summarizes the elderly person's day and activities
  2. Notes their overall wellbeing and mood
  3. Highlights any potential concerns
  4. Includes a summary of their medication adherence for the day
  5. Keeps a warm, positive tone while being factual
  
  Format it nicely with appropriate sections, bullet points where helpful, and emojis where appropriate.`;
      
      const response = await openaiClient.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are an elderly care assistant that generates concise, informative daily reports for caregivers. Your reports highlight key information while maintaining privacy and dignity."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.5,
        max_tokens: 600
      });
      
      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error(`❌ Error formatting daily report: ${error}`);
      
      // Fallback basic report
      let report = `*Daily Report for ${elderlyUserData.name}*\n\n`;
      report += `Date: ${new Date().toLocaleDateString()}\n\n`;
      
      checkIns.forEach((checkIn, index) => {
        const time = new Date(checkIn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        report += `${time}: ${checkIn.response || "No response"}\n\n`;
      });
      
      report += `Medication Summary:\n${medicationSummary}\n\n`;
      
      return report;
    }
  }
  

/**
 * Schedule daily report generation 
 */
function scheduleDailyReports() {
  // Calculate time until report generation (default: 8:00 PM)
  const now = new Date();
  const reportTime = new Date();
  reportTime.setHours(21, 19, 0, 0);
  
  // If already past 8 PM, schedule for tomorrow
  if (now >= reportTime) {
    reportTime.setDate(reportTime.getDate() + 1);
  }
  
  const delayMs = reportTime.getTime() - now.getTime();
  
  console.log(`📊 Scheduling daily reports for ${reportTime.toLocaleString()} (in ${Math.round(delayMs/60000)} minutes)`);
  
  // Schedule the report generation
  setTimeout(() => {
    // Generate and send reports
    sendDailyReports();
    
    // Schedule the next day's reports
    scheduleDailyReports();
  }, delayMs);
}


/**
 * Determine if a follow-up question is needed based on initial analysis
 * @param {Object} analysis - Initial response analysis
 * @returns {boolean} - Whether follow-up is needed
 */
function determineIfFollowUpNeeded(analysis) {
  // Follow up if:
  // 1. Sentiment is negative or neutral
  // 2. There are any concerns mentioned
  // 3. Physical or emotional wellbeing is fair or concerning
  // 4. The response is very brief (less than 10 words)
  
  const hasNegativeSentiment = analysis.sentiment === 'negative' || analysis.sentiment === 'neutral';
  const hasConcerns = analysis.concerns && analysis.concerns.length > 0;
  const hasWellbeingIssues = 
    analysis.wellbeing.physical === 'concerning' || 
    analysis.wellbeing.physical === 'fair' ||
    analysis.wellbeing.emotional === 'concerning' || 
    analysis.wellbeing.emotional === 'fair';
  
  return hasNegativeSentiment || hasConcerns || hasWellbeingIssues;
}

/**
* Determine if a second follow-up question is needed
* @param {Object} analysis - Updated analysis after first follow-up
* @param {Array} conversationHistory - Conversation so far
* @returns {boolean} - Whether second follow-up is needed
*/
function determineIfSecondFollowUpNeeded(analysis, conversationHistory) {
 // Get the last user response
 const lastUserResponse = conversationHistory.filter(msg => msg.role === 'user').pop();
 
 // Second follow-up if:
 // 1. New concerns emerged in the follow-up
 // 2. Response indicates distress or need for more information
 // 3. Response is very brief or vague
 
 const hasCriticalConcerns = 
   analysis.concerns && 
   analysis.concerns.some(concern => 
     concern.toLowerCase().includes('pain') || 
     concern.toLowerCase().includes('severe') ||
     concern.toLowerCase().includes('worried')
   );
 
 // Also check response length - if very brief, might need more follow-up
 const isBriefResponse = lastUserResponse && lastUserResponse.content.split(' ').length < 5;
 
 return hasCriticalConcerns || isBriefResponse;
}

/**
* Generate a follow-up question based on initial response
* @param {string} userId - User's ID
* @param {string} initialResponse - User's initial response
* @param {Object} analysis - Analysis of the initial response
* @returns {Promise<string>} - Follow-up question
*/
async function generateFollowUpQuestion(userId, initialResponse, analysis) {
 try {
   const openaiClient = createOpenAIClient();
   const userData = await UserModel.getUserDetails(userId);
   
   // Tailor follow-up based on analysis
   let followUpFocus = "";
   
   if (analysis.wellbeing.physical === 'concerning' || analysis.wellbeing.physical === 'fair') {
     followUpFocus = "physical_health";
   } else if (analysis.wellbeing.emotional === 'concerning' || analysis.wellbeing.emotional === 'fair') {
     followUpFocus = "emotional_wellbeing";
   } else if (analysis.wellbeing.social === 'concerning' || analysis.wellbeing.social === 'fair') {
     followUpFocus = "social_connection";
   } else if (analysis.concerns.length > 0) {
     followUpFocus = "expressed_concerns";
   } else {
     followUpFocus = "general_wellbeing";
   }
   
   const prompt = `Generate a natural, caring follow-up question to continue a check-in conversation with an elderly person.

User's name: ${userData?.name || "there"}
Their initial response: "${initialResponse}"

Analysis of their response:
- Sentiment: ${analysis.sentiment}
- Activities mentioned: ${analysis.activities.join(', ') || "None mentioned"}
- Wellbeing: Physical (${analysis.wellbeing.physical}), Emotional (${analysis.wellbeing.emotional}), Social (${analysis.wellbeing.social})
- Concerns: ${analysis.concerns.join(', ') || "None identified"}

Focus area for follow-up: ${followUpFocus}

Guidelines:
1. Ask ONE specific follow-up question that feels natural and caring, not clinical
2. Make it feel like a genuine conversation, not an interrogation
3. Be gentle and supportive, especially if their initial response suggests concerns
4. Acknowledge something from their first response to create continuity
5. Keep it brief (1-2 sentences)
6. Include their name and an emoji if appropriate

Examples of good follow-up questions:
- "That sounds interesting, John! Could you tell me a bit more about how that made you feel? 😊"
- "I'm sorry to hear you're not feeling well, Maria. Have you been able to get any rest today? 💗"
- "It sounds like you've had a busy morning! What are you looking forward to this afternoon? ✨"`;

   const response = await openaiClient.chat.completions.create({
     model: "gpt-3.5-turbo",
     messages: [
       {
         role: "system",
         content: "You are a compassionate companion for elderly individuals. Your follow-up questions are warm, specific, and show genuine interest in their wellbeing."
       },
       {
         role: "user",
         content: prompt
       }
     ],
     temperature: 0.7,
     max_tokens: 150
   });
   
   return response.choices[0].message.content.trim();
 } catch (error) {
   console.error(`❌ Error generating follow-up question: ${error}`);
   return "That's interesting. Could you tell me a bit more about how you're feeling today? 😊";
 }
}

/**
* Generate a second, more specific follow-up question
* @param {string} userId - User's ID
* @param {Object} analysis - Updated analysis after first follow-up
* @returns {Promise<string>} - Second follow-up question
*/
async function generateSecondFollowUpQuestion(userId, analysis) {
 try {
   const openaiClient = createOpenAIClient();
   const userData = await UserModel.getUserDetails(userId);
   
   const prompt = `Generate a final, gentle follow-up question for an elderly person that helps complete our understanding of their wellbeing.

User's name: ${userData?.name || "there"}

Current understanding of their wellbeing:
- Sentiment: ${analysis.sentiment}
- Physical wellbeing: ${analysis.wellbeing.physical}
- Emotional wellbeing: ${analysis.wellbeing.emotional}
- Social wellbeing: ${analysis.wellbeing.social}
- Concerns identified: ${analysis.concerns.join(', ') || "None identified"}

Guidelines:
1. Ask ONE specific question that helps complete your understanding of their current state
2. If they've expressed concerns, gently ask about what might help them feel better
3. If their emotional state seems low, focus on support and coping strategies
4. Make it warm and conversational, not clinical
5. Keep it brief (1-2 sentences)
6. Include their name and an emoji if appropriate

This should feel like the natural conclusion to a brief, caring check-in conversation.`;

   const response = await openaiClient.chat.completions.create({
     model: "gpt-3.5-turbo",
     messages: [
       {
         role: "system",
         content: "You are a compassionate companion for elderly individuals. Your follow-up questions are warm, specific, and show genuine interest in their wellbeing."
       },
       {
         role: "user",
         content: prompt
       }
     ],
     temperature: 0.7,
     max_tokens: 150
   });
   
   return response.choices[0].message.content.trim();
 } catch (error) {
   console.error(`❌ Error generating second follow-up question: ${error}`);
   return "Is there anything specific that would help you feel better today? I'm here to listen. 💗";
 }
}

/**
* Analyze the complete conversation for a more accurate assessment
* @param {Array} conversationHistory - Full conversation history
* @param {Object} initialAnalysis - Analysis of initial response
* @returns {Promise<Object>} - Updated comprehensive analysis
*/
async function analyzeConversation(conversationHistory, initialAnalysis) {
 try {
   const openaiClient = createOpenAIClient();
   
   // Convert conversation history to a readable format
   const conversationText = conversationHistory.map(msg => 
     `${msg.role === 'user' ? 'Elderly person' : 'Assistant'}: ${msg.content}`
   ).join('\n\n');
   
   const prompt = `Analyze this complete check-in conversation with an elderly person to provide a comprehensive assessment of their wellbeing.

Conversation:
${conversationText}

Initial analysis from first response:
- Sentiment: ${initialAnalysis.sentiment}
- Activities: ${initialAnalysis.activities.join(', ') || "None mentioned"}
- Physical wellbeing: ${initialAnalysis.wellbeing.physical}
- Emotional wellbeing: ${initialAnalysis.wellbeing.emotional}
- Social wellbeing: ${initialAnalysis.wellbeing.social}
- Initial concerns: ${initialAnalysis.concerns.join(', ') || "None identified"}

Based on the FULL conversation, provide an updated analysis with:
1. Overall sentiment (positive, neutral, negative)
2. Activities mentioned throughout the conversation
3. Wellbeing indicators (physical, emotional, social - each rated as good, fair, or concerning)
4. Any concerns or issues that might need attention
5. Any help or assistance they might need

Format the response as a JSON object with these fields.`;

   const aiResponse = await openaiClient.chat.completions.create({
     model: "gpt-3.5-turbo",
     messages: [
       {
         role: "system",
         content: "You are an analytical assistant that extracts structured information from conversations. Respond only with valid JSON."
       },
       {
         role: "user",
         content: prompt
       }
     ],
     temperature: 0.3,
     max_tokens: 500,
     response_format: { type: "json_object" }
   });
   
   // Parse the JSON response
   return JSON.parse(aiResponse.choices[0].message.content);
 } catch (error) {
   console.error(`❌ Error analyzing conversation: ${error}`);
   
   // If analysis fails, use the initial analysis as fallback
   return initialAnalysis;
 }
}

/**
* Finalize the check-in process
* @param {string} userId - User's ID
* @param {Object} session - Check-in session data
* @param {Object} analysis - Final conversation analysis
* @returns {Promise<Object>} - Result with follow-up message
*/
async function finalizeCheckIn(userId, session, analysis) {
 try {
   // Create the check-in data object with full conversation
   const checkInData = {
     checkInId: `${userId}_${Date.now()}`,
     userId: userId,
     timestamp: session.timestamp,
     timeSlot: session.timeSlot,
     question: session.question,
     response: session.conversationHistory.filter(msg => msg.role === 'user')[0].content,
     fullConversation: session.conversationHistory,
     conversationTurns: session.conversationHistory.filter(msg => msg.role === 'user').length,
     sentiment: analysis.sentiment,
     activities: analysis.activities,
     wellbeing: analysis.wellbeing,
     concerns: analysis.concerns,
     needsAssistance: analysis.needsAssistance || false,
     reportedTo: null,
     reported: false
   };
   
   // Save to database using the model
   await CheckInModel.saveCheckIn(checkInData);
   console.log(`Saved check-in conversation from ${userId} with ${checkInData.conversationTurns} user turns`);
   
   // Generate a final response
   const finalResponse = await generateFinalResponse(userId, analysis, session.conversationHistory);
   
   // Check if any urgent concerns were identified that need immediate attention
   if (analysis.concerns && analysis.concerns.some(c => 
       c.toLowerCase().includes('emergency') || 
       c.toLowerCase().includes('severe') ||
       c.toLowerCase().includes('urgent'))) {
     // Here you could add code to send alerts to caregivers for urgent concerns
     console.log(`⚠️ URGENT CONCERN DETECTED for ${userId}: ${analysis.concerns.join(', ')}`);
   }
   
   // Clear the active session
   delete activeCheckInSessions[userId];
   
   return {
     success: true,
     followUp: finalResponse,
     conversationComplete: true
   };
 } catch (error) {
   console.error(`❌ Error finalizing check-in: ${error}`);
   
   // Try to clear the session even if there was an error
   delete activeCheckInSessions[userId];
   
   return {
     success: false,
     message: "Error processing your responses, but thank you for checking in. I'll check in with you again later."
   };
 }
}

/**
* Generate a final response to conclude the check-in conversation
* @param {string} userId - User's ID
* @param {Object} analysis - Final analysis
* @param {Array} conversationHistory - Full conversation history
* @returns {Promise<string>} - Final response
*/
async function generateFinalResponse(userId, analysis, conversationHistory) {
 try {
   const openaiClient = createOpenAIClient();
   const userData = await UserModel.getUserDetails(userId);
   
   // Get the last user message for context
   const lastUserMessage = conversationHistory.filter(msg => msg.role === 'user').pop().content;
   
   const prompt = `Generate a warm, supportive final message to conclude a check-in conversation with an elderly person.

User's name: ${userData?.name || "Friend"}
Their last message: "${lastUserMessage}"

Analysis of the conversation:
- Overall sentiment: ${analysis.sentiment}
- Physical wellbeing: ${analysis.wellbeing.physical}
- Emotional wellbeing: ${analysis.wellbeing.emotional}
- Social wellbeing: ${analysis.wellbeing.social}
- Concerns: ${analysis.concerns.join(', ') || "None identified"}

Guidelines:
1. Be warm, empathetic, and supportive
2. Acknowledge something specific from their responses
3. If they expressed concerns, offer gentle encouragement or validation
4. If appropriate, include a simple suggestion for wellbeing (but nothing prescriptive)
5. Keep it brief (2-3 sentences)
6. Include their name
7. Add an appropriate emoji
8. Don't ask follow-up questions that require a response

Your response should feel like a natural, caring conclusion to the conversation.`;

   const response = await openaiClient.chat.completions.create({
     model: "gpt-3.5-turbo",
     messages: [
       {
         role: "system",
         content: "You are a caring companion who checks in on elderly people. Your responses are warm, specific, and demonstrate genuine care."
       },
       {
         role: "user",
         content: prompt
       }
     ],
     temperature: 0.7,
     max_tokens: 200
   });
   
   return response.choices[0].message.content.trim();
 } catch (error) {
   console.error(`❌ Error generating final response: ${error}`);
   return "Thank you so much for sharing that with me. I appreciate our conversation and hope you have a lovely rest of your day. Take care! 💗";
 }
}



/**
 * Execute a check-in immediately for testing
 * @param {string} timeSlot - Type of check-in (morning/midday/evening)
 */
async function executeImmediateCheckIn(timeSlot = 'evening') {
    console.log(`🧪 TEST: Executing immediate ${timeSlot} check-in at ${new Date().toLocaleString()}`);
    
    // Get all elderly users from the database
    const params = {
      TableName: DB_TABLES.USERS_TABLE,
      FilterExpression: "userType = :type",
      ExpressionAttributeValues: {
        ":type": "elderly"
      }
    };
    
    const result = await dynamoDB.scan(params).promise();
    const elderlyUsers = result.Items || [];
    
    console.log(`🧪 TEST: Found ${elderlyUsers.length} elderly users for test check-in`);
    
    // Send check-ins to each user
    for (const user of elderlyUsers) {
      if (user.checkInsOptOut) {
        console.log(`⏭️ User ${user.phoneNumber} has opted out of check-ins`);
        continue;
      }
      
      // Generate and send check-in question
      const checkInMessage = await generateCheckInQuestion(user.phoneNumber, timeSlot);
      await sendWhatsAppMessage(user.phoneNumber, checkInMessage);
      
      // Track the active check-in session
      activeCheckInSessions[user.phoneNumber] = {
        timeSlot: timeSlot,
        question: checkInMessage,
        timestamp: new Date().toISOString(),
        conversationState: 'initial',
        conversationHistory: [{ role: 'assistant', content: checkInMessage }]
      };
      
      console.log(`✅ TEST: Sent immediate test ${timeSlot} check-in to ${user.phoneNumber}`);
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }


/**
 * Get today's medication summary for a user.
 * This function retrieves the user's medications, filters those active for today,
 * and then summarizes how many times each medication was taken or missed today.
 *
 * @param {string} userPhone - The user's phone number.
 * @returns {Promise<string>} - Formatted summary of today's medication activity.
 */
async function getMedicationSummary(userPhone) {
    try {
      const standardizedPhone = standardizePhoneNumber(userPhone);
      // Retrieve all medications for the user using the MedicationModel
      const medications = await MedicationModel.getUserMedications(standardizedPhone);
      let responseMessage = `💊 *Medication Summary for ${standardizedPhone} (Today)*:\n\n`;
      
      // Get today's date in YYYY-MM-DD format
      const today = new Date();
      const todayDateStr = today.toISOString().split('T')[0];
      
      // Filter medications that are active today (startDate <= today <= endDate)
      const activeMedications = medications.filter(med => {
        const startDate = new Date(med.startDate);
        const endDate = new Date(med.endDate);
        return startDate <= today && endDate >= today;
      });
      
      if (activeMedications.length === 0) {
        responseMessage += "No medications scheduled for today.";
        return responseMessage;
      }
      
      // Process each active medication
      activeMedications.forEach(med => {
        const takenTimes = med.takenTimes || [];
        const missedTimes = med.missedTimes || [];
        // Filter timestamps to only include those from today
        const filteredTaken = takenTimes.filter(date => date.startsWith(todayDateStr));
        const filteredMissed = missedTimes.filter(date => date.startsWith(todayDateStr));
        
        // Format the timestamps using formatDate (imported from timeUtils)
        const formattedTaken = filteredTaken.length 
          ? filteredTaken.map(date => formatDate(date)).join(', ') 
          : 'None';
        const formattedMissed = filteredMissed.length 
          ? filteredMissed.map(date => formatDate(date)).join(', ') 
          : 'None';
        
        // Construct the summary for this medication
        responseMessage += `💊 *${med.medicine}*:\n`;
        responseMessage += `   - Dosage: ${med.dosage || 'Not specified'}\n`;
        responseMessage += `   - Reminder Time(s): ${Array.isArray(med.reminderTimes) ? med.reminderTimes.map(item => item.S || item).join(', ') : med.time}\n`;
        responseMessage += `   - Frequency: ${med.frequency || 'Not specified'}\n`;
        responseMessage += `   - Duration: ${med.duration ? med.duration + ' days' : 'Ongoing'}\n`;
        responseMessage += `   - Start Date: ${med.startDate ? formatDate(med.startDate) : 'N/A'}\n`;
        responseMessage += `   - End Date: ${med.endDate ? formatDate(med.endDate) : 'Ongoing'}\n`;
        responseMessage += `   - Taken: ${filteredTaken.length} times\n`;
        responseMessage += `       *Dates:* ${formattedTaken}\n`;
        responseMessage += `   - Missed: ${filteredMissed.length} times\n`;
        responseMessage += `       *Dates:* ${formattedMissed}\n\n`;
      });
      
      return responseMessage.trim();
    } catch (error) {
      console.error(`❌ Error generating medication summary: ${error}`);
      return "❌ Medication summary unavailable. Please try again later.";
    }
  }


// Export the functions
module.exports = {
 initializeCheckInScheduler,
 processCheckInResponse,
 scheduleDailyReports,
 generateDailyReport,
 sendDailyReports,
 getMedicationSummary
};