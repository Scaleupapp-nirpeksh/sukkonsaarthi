// services/medicationInfoService.js - Service to fetch medication information
const { createOpenAIClient } = require('../config/config');

/**
 * Get information about a medication using GPT
 * @param {string} medicationName - Name of the medication
 * @param {string} dosage - Dosage of the medication (optional)
 * @returns {Promise<string>} - Formatted information about the medication
 */
async function getMedicationInfo(medicationName, dosage = null) {
  try {
    const openaiClient = createOpenAIClient();
    
    // Create a detailed prompt for better results
    let prompt = `Provide concise, patient-friendly information about ${medicationName}`;
    
    if (dosage) {
      prompt += ` at a dosage of ${dosage}`;
    }
    
    prompt += `.\n\nInclude the following details in your response:
    1. What class of medication it is
    2. Common uses/indications
    3. How it works (mechanism in simple terms)
    4. Common side effects (only most common 3-4)
    5. Important warnings or precautions
    
    Format the response as a WhatsApp message with emoji and clear headings. Keep it factual, concise, and educational.`;

    // Call OpenAI API
    const response = await openaiClient.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful pharmacist assistant providing medical information about medications in a clear, concise, and patient-friendly way. Only provide factual medical information without medical advice."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3, // Keep responses consistent and factual
      max_tokens: 500 // Limit response length for WhatsApp readability
    });

    // Add a disclaimer
    const disclaimer = "\n\n⚠️ *Disclaimer*: This information is educational only and doesn't replace medical advice. Always consult your healthcare provider.";
    return response.choices[0].message.content + disclaimer;
  } catch (error) {
    console.error(`❌ Error fetching medication info for ${medicationName}:`, error);
    return `Sorry, I couldn't retrieve information about ${medicationName} at this time. Please try again later or consult your healthcare provider for information.`;
  }
}

/**
 * Creates a function to check if user is asking about medication info
 * @returns {Function} - Function to check message intent
 */
function createMedicationInfoMatcher() {
  // Generic medication reference patterns to ignore
  const genericMedicationPatterns = [
    /my medicine[s]?/i,
    /my medication[s]?/i,
    /my drug[s]?/i,
    /my prescription[s]?/i,
    /the medicine[s]?/i
  ];
  
  // Common patterns for asking about medication information
  const medicationInfoPatterns = [
    /what is (.+)\??/i,
    /tell me about (.+)/i,
    /information (on|about) (.+)/i,
    /info (on|about) (.+)/i,
    /details (on|about) (.+)/i,
    /about (.+)/i,
    /info (.+)/i,
    /medicine info (.+)/i,
    /drug info (.+)/i
  ];

  return (message) => {
    // First check if this is a generic query about "my medications"
    for (const pattern of genericMedicationPatterns) {
      if (pattern.test(message)) {
        // This is a generic query about the user's medications
        return null;
      }
    }
    
    // Then check if it's a specific question about a medication
    for (const pattern of medicationInfoPatterns) {
      const match = message.match(pattern);
      if (match) {
        const potentialMedName = match[match.length - 1].trim();
        
        // Skip if it matches the generic patterns
        let isGeneric = false;
        for (const genericPattern of genericMedicationPatterns) {
          if (genericPattern.test(potentialMedName)) {
            isGeneric = true;
            break;
          }
        }
        
        if (!isGeneric) {
          // Return the potential medication name from the match
          return potentialMedName;
        } else {
          return null;
        }
      }
    }
    
    // Check for more explicit mention of medication info
    if (message.toLowerCase().includes('medicine info') || 
        message.toLowerCase().includes('medication info') ||
        message.toLowerCase().includes('drug info')) {
      // Extract the medication name from after "medicine info" or similar phrases
      const parts = message.toLowerCase().split(/medicine info|medication info|drug info/);
      if (parts.length > 1 && parts[1].trim()) {
        const potentialMedName = parts[1].trim();
        
        // Skip if it matches the generic patterns
        for (const pattern of genericMedicationPatterns) {
          if (pattern.test(potentialMedName)) {
            return null;
          }
        }
        
        return potentialMedName;
      }
    }
    
    return null;
  };
}

/**
 * Process a medication info request and get relevant information
 * @param {string} message - User message
 * @param {Array} userMedications - User's medication list from database
 * @returns {Promise<string|null>} - Medication information response or null if not a medication info request
 */
async function processMedicationInfoRequest(message, userMedications) {
  console.log(`🔍 Processing medication info request: "${message}"`);
  
  // Create the message intent matcher
  const getMedicationNameFromMessage = createMedicationInfoMatcher();
  
  // Get potential medication name from message
  let medicationName = getMedicationNameFromMessage(message);
  console.log(`Extracted medication name: "${medicationName}"`);
  
  // Handle generic queries about the user's medications
  const isGenericMedicationQuery = !medicationName && (
    message.toLowerCase().includes('my medicine') || 
    message.toLowerCase().includes('my medication') || 
    message.toLowerCase().includes('my drug') ||
    message.toLowerCase().includes('tell me about my') ||
    message.toLowerCase().includes('information about my') ||
    message.toLowerCase().includes('about medicine')
  );
  
  // If no specific medication was mentioned, but it's a generic query
  if (isGenericMedicationQuery) {
    console.log("Detected generic query about user's medications");
    
    // If user has only one medication, assume they're asking about that
    if (userMedications && userMedications.length === 1) {
      medicationName = userMedications[0].medicine;
      console.log(`User has only one medication: ${medicationName}`);
    } else if (userMedications && userMedications.length > 1) {
      // If user has multiple medications, ask which one
      const medicineList = userMedications.map(med => med.medicine).join(', ');
      console.log(`User has multiple medications: ${medicineList}`);
      return `You're currently taking these medications: ${medicineList}. Which one would you like information about?`;
    } else {
      console.log("User has no medications saved");
      return "I don't have any medications saved for you. Please specify which medication you'd like information about.";
    }
  } else if (!medicationName) {
    // Not a medication info request
    console.log("Not a medication info request");
    return null;
  }
  
  // Check if the medication is in the user's medication list
  let matchedMedication = null;
  if (userMedications && userMedications.length > 0) {
    matchedMedication = userMedications.find(med => 
      med.medicine.toLowerCase() === medicationName.toLowerCase() ||
      med.medicine.toLowerCase().includes(medicationName.toLowerCase()) ||
      medicationName.toLowerCase().includes(med.medicine.toLowerCase())
    );
  }
  
  // Get the medication info
  if (matchedMedication) {
    console.log(`Found matching medication in user's list: ${matchedMedication.medicine}`);
    return await getMedicationInfo(matchedMedication.medicine, matchedMedication.dosage);
  } else {
    // If medication isn't in their list, still provide info but note that
    console.log(`Medication not found in user's list, providing general info for: ${medicationName}`);
    return await getMedicationInfo(medicationName);
  }
}

module.exports = {
  getMedicationInfo,
  processMedicationInfoRequest
};