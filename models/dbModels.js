// models/dbModels.js - Database access functions
const { DB_TABLES, createDynamoDBClient } = require('../config/config');
const dynamoDB = createDynamoDBClient();

/**
 * User-related database functions
 */
const UserModel = {
    /**
     * Create a new user in the database
     * @param {string} phoneNumber - User's phone number
     * @param {string} userType - Type of user (elderly or child)
     * @param {Object} userData - Additional user data
     * @returns {Promise<boolean>} - Success status
     */
    createUser: async (phoneNumber, userType, userData) => {
        try {
            const params = {
                TableName: DB_TABLES.USERS_TABLE,
                Item: {
                    phoneNumber,
                    userType,
                    ...userData,
                    createdAt: new Date().toISOString()
                }
            };

            await dynamoDB.put(params).promise();
            console.log(`✅ New ${userType} user created with phone ${phoneNumber}`);
            return true;
        } catch (error) {
            console.error(`❌ Error creating user: ${error}`);
            return false;
        }
    },

    /**
     * Check if a user exists in the database
     * @param {string} phoneNumber - User's phone number
     * @returns {Promise<boolean>} - Whether the user exists
     */
    checkUserExists: async (phoneNumber) => {
        try {
            const params = {
                TableName: DB_TABLES.USERS_TABLE,
                Key: { phoneNumber }
            };

            const result = await dynamoDB.get(params).promise();
            return !!result.Item;
        } catch (error) {
            console.error(`❌ Error checking user existence: ${error}`);
            return false;
        }
    },

    /**
     * Get user details from the database
     * @param {string} phoneNumber - User's phone number
     * @returns {Promise<Object|null>} - User data or null if not found
     */
    getUserDetails: async (phoneNumber) => {
        try {
            const params = {
                TableName: DB_TABLES.USERS_TABLE,
                Key: { phoneNumber }
            };

            const result = await dynamoDB.get(params).promise();
            return result.Item || null;
        } catch (error) {
            console.error(`❌ Error getting user details: ${error}`);
            return null;
        }
    }
};

/**
 * Relationship-related database functions
 */
const RelationshipModel = {
    /**
     * Create a relationship between parent and child
     * @param {string} parentPhone - Parent's phone number
     * @param {string} childPhone - Child's phone number
     * @param {string} relationshipType - Type of relationship
     * @returns {Promise<boolean>} - Success status
     */
    createRelationship: async (parentPhone, childPhone, relationshipType) => {
        try {
            const params = {
                TableName: DB_TABLES.RELATIONSHIPS_TABLE,
                Item: {
                    relationshipId: `${parentPhone}_${childPhone}`,
                    parentPhone,
                    childPhone,
                    relationship: relationshipType,
                    permissions: ['view_medications', 'manage_medications', 'view_symptoms', 'view_reports'],
                    createdAt: new Date().toISOString()
                }
            };

            await dynamoDB.put(params).promise();
            console.log(`✅ Relationship created between parent ${parentPhone} and child ${childPhone}`);
            return true;
        } catch (error) {
            console.error(`❌ Error creating relationship: ${error}`);
            return false;
        }
    },

    /**
     * Get all relationships for a child
     * @param {string} childPhone - Child's phone number
     * @returns {Promise<Array>} - Array of relationships
     */
    getChildRelationships: async (childPhone) => {
        try {
            const params = {
                TableName: DB_TABLES.RELATIONSHIPS_TABLE,
                IndexName: 'ChildIndex',
                KeyConditionExpression: "childPhone = :cp",
                ExpressionAttributeValues: {
                    ":cp": childPhone
                }
            };

            const result = await dynamoDB.query(params).promise();
            return result.Items || [];
        } catch (error) {
            console.error(`❌ Error getting child relationships: ${error}`);
            return [];
        }
    },

    /**
     * Get relationship between parent and child
     * @param {string} childPhone - Child's phone number
     * @param {string} parentPhone - Parent's phone number
     * @returns {Promise<Object|null>} - Relationship data or null if not found
     */
    getRelationship: async (childPhone, parentPhone) => {
        try {
            const params = {
                TableName: DB_TABLES.RELATIONSHIPS_TABLE,
                IndexName: 'ChildIndex',
                KeyConditionExpression: "childPhone = :cp",
                FilterExpression: "parentPhone = :pp",
                ExpressionAttributeValues: {
                    ":cp": childPhone,
                    ":pp": parentPhone
                }
            };

            const result = await dynamoDB.query(params).promise();
            return result.Items.length > 0 ? result.Items[0] : null;
        } catch (error) {
            console.error(`❌ Error getting relationship: ${error}`);
            return null;
        }
    },

    /**
 * Get all relationships from the database
 * @returns {Promise<Array>} - All relationships
 */
getAllRelationships: async () => {
    try {
        const params = {
            TableName: DB_TABLES.RELATIONSHIPS_TABLE
        };
        
        const result = await dynamoDB.scan(params).promise();
        return result.Items || [];
    } catch (error) {
        console.error(`❌ Error getting all relationships: ${error}`);
        return [];
    }
}
};

/**
 * Medication-related database functions
 */
const MedicationModel = {
    /**
     * Add a medication to the database
     * @param {string} userPhone - User's phone number
     * @param {string} medicine - Medicine name
     * @param {string} time - Reminder time
     * @param {string} dosage - Medicine dosage
     * @param {string} frequency - Frequency of medicine
     * @param {string} duration - Duration of medicine
     * @param {string} proxyUser - Who added the medication (if proxy)
     * @returns {Promise<boolean>} - Success status
     */
    addMedication: async (userPhone, medicine, time, dosage = null, frequency = "daily", duration = null, proxyUser = null) => {
        try {
            const startDate = new Date();
            let endDate = null;
    
            if (duration && !isNaN(parseInt(duration))) {
                endDate = new Date();
                endDate.setDate(endDate.getDate() + parseInt(duration));
            }
            
            // Generate reminder times based on frequency
            const { generateReminderTimes } = require('../utils/timeUtils');
            const reminderTimes = generateReminderTimes(time, frequency);
            
            const params = {
                TableName: DB_TABLES.MEDICATIONS_TABLE,
                Item: {
                    userPhone,
                    medicine,
                    time,
                    reminderTimes: reminderTimes, // Use the generated reminder times here
                    taken: false,
                    dosage,
                    frequency,
                    duration,
                    startDate: startDate.toISOString(),
                    endDate: endDate ? endDate.toISOString() : null,
                    missedCount: 0,
                    takenCount: 0,
                    takenTimes: [],
                    missedTimes: [],
                    addedBy: proxyUser
                }
            };
    
            await dynamoDB.put(params).promise();
            console.log(`✅ Medication added for ${userPhone}: ${medicine}${proxyUser ? ` by ${proxyUser}` : ''}`);
            return true;
        } catch (error) {
            console.error(`❌ Error adding medication: ${error}`);
            return false;
        }
    }
    
    
    ,

    /**
     * Update a medication in the database
     * @param {string} userPhone - User's phone number
     * @param {string} oldMedicineName - Old medicine name
     * @param {string} updateData - Data to update
     * @returns {Promise<Object>} - Update result
     */
    updateMedication: async (userPhone, oldMedicineName, updateData) => {
        try {
            // First, check if the medication exists
            const medications = await MedicationModel.getUserMedications(userPhone);
            const medicationToUpdate = medications.find(med => 
                med.medicine.toLowerCase() === oldMedicineName.toLowerCase()
            );
            
            if (!medicationToUpdate) {
                console.error(`❌ Medicine "${oldMedicineName}" not found for user ${userPhone}`);
                return { success: false };
            }
            
            // If the medicine name hasn't changed, use update
            if (oldMedicineName.toLowerCase() === (updateData.newMedicineName || oldMedicineName).toLowerCase()) {
                const updateParams = {
                    TableName: DB_TABLES.MEDICATIONS_TABLE,
                    Key: {
                        userPhone: userPhone,
                        medicine: medicationToUpdate.medicine
                    },
                    UpdateExpression: updateData.updateExpression,
                    ExpressionAttributeValues: updateData.expressionAttributeValues,
                    ExpressionAttributeNames: updateData.expressionAttributeNames
                };
                
                await dynamoDB.update(updateParams).promise();
            } else {
                // If name changed, add new record and delete old
                const newItem = {
                    ...medicationToUpdate,
                    ...updateData.newItem,
                    medicine: updateData.newMedicineName
                };
                
                const params = {
                    TableName: DB_TABLES.MEDICATIONS_TABLE,
                    Item: newItem
                };
                
                await dynamoDB.put(params).promise();
                
                // Delete the old record
                const deleteParams = {
                    TableName: DB_TABLES.MEDICATIONS_TABLE,
                    Key: {
                        userPhone: userPhone,
                        medicine: medicationToUpdate.medicine
                    }
                };
                
                await dynamoDB.delete(deleteParams).promise();
            }
            
            console.log(`✅ Updated medication for ${userPhone}: ${oldMedicineName}`);
            return { success: true };
        } catch (error) {
            console.error(`❌ Error updating medication: ${error}`);
            return { success: false };
        }
    },

    /**
     * Get medications for a user
     * @param {string} userPhone - User's phone number
     * @returns {Promise<Array>} - Array of medications
     */
    getUserMedications: async (userPhone) => {
        try {
            // Handle the case when userPhone is null (called from reminderService)
            if (!userPhone) {
                // Return empty array or optionally perform a scan operation
                const scanParams = {
                    TableName: DB_TABLES.MEDICATIONS_TABLE
                };
                
                const scanResult = await dynamoDB.scan(scanParams).promise();
                return scanResult.Items || [];
            }
            
            const params = {
                TableName: DB_TABLES.MEDICATIONS_TABLE,
                KeyConditionExpression: "userPhone = :userPhone",
                ExpressionAttributeValues: { ":userPhone": userPhone.toString() }
            };

            const data = await dynamoDB.query(params).promise();
            return data.Items || [];
        } catch (error) {
            console.error(`❌ Error getting medications: ${error}`);
            return [];
        }
    },

    /**
     * Mark a medication as taken
     * @param {string} userPhone - User's phone number
     * @param {string} medicine - Medicine name
     * @returns {Promise<boolean>} - Success status
     */
    markMedicationAsTaken: async (userPhone, medicine) => {
        try {
            const medications = await MedicationModel.getUserMedications(userPhone);
            const medicationToUpdate = medications.find(med => 
                med.medicine.toLowerCase() === medicine.toLowerCase()
            );

            if (!medicationToUpdate) {
                console.error(`❌ Medicine "${medicine}" not found for user ${userPhone}`);
                return false;
            }

            const takenCount = (medicationToUpdate.takenCount || 0) + 1;
            const takenTimes = medicationToUpdate.takenTimes || [];
            takenTimes.push(new Date().toISOString());

            const params = {
                TableName: DB_TABLES.MEDICATIONS_TABLE,
                Key: {
                    userPhone: userPhone,
                    medicine: medicationToUpdate.medicine
                },
                UpdateExpression: "set taken = :t, takenCount = :tc, takenTimes = :tt",
                ExpressionAttributeValues: {
                    ":t": true,
                    ":tc": takenCount,
                    ":tt": takenTimes
                }
            };

            await dynamoDB.update(params).promise();
            console.log(`✅ ${medicine} marked as taken for ${userPhone}`);
            return true;
        } catch (error) {
            console.error(`❌ Error marking medicine as taken: ${error}`);
            return false;
        }
    },

    /**
     * Mark a medication as missed
     * @param {string} userPhone - User's phone number
     * @param {string} medicine - Medicine name
     * @returns {Promise<boolean>} - Success status
     */
    markMedicationAsMissed: async (userPhone, medicine) => {
        try {
            const medications = await MedicationModel.getUserMedications(userPhone);
            const medicationToUpdate = medications.find(med => 
                med.medicine.toLowerCase() === medicine.toLowerCase()
            );

            if (!medicationToUpdate) {
                console.error(`❌ Medicine "${medicine}" not found for user ${userPhone}`);
                return false;
            }

            const missedCount = (medicationToUpdate.missedCount || 0) + 1;
            const missedTimes = medicationToUpdate.missedTimes || [];
            missedTimes.push(new Date().toISOString());

            const params = {
                TableName: DB_TABLES.MEDICATIONS_TABLE,
                Key: {
                    userPhone: userPhone,
                    medicine: medicationToUpdate.medicine
                },
                UpdateExpression: "set missedCount = :mc, missedTimes = :mt",
                ExpressionAttributeValues: {
                    ":mc": missedCount,
                    ":mt": missedTimes
                }
            };

            await dynamoDB.update(params).promise();
            console.log(`⚠️ ${medicine} marked as missed for ${userPhone}`);
            return true;
        } catch (error) {
            console.error(`❌ Error marking medicine as missed: ${error}`);
            return false;
        }
    },
    
    /**
     * Get all medications (for reminder service)
     * @returns {Promise<Array>} - Array of all medications
     */
    getAllMedications: async () => {
        try {
            const params = {
                TableName: DB_TABLES.MEDICATIONS_TABLE
            };
            
            const result = await dynamoDB.scan(params).promise();
            return result.Items || [];
        } catch (error) {
            console.error(`❌ Error scanning all medications: ${error}`);
            return [];
        }
    },

    /**
 * Delete a medication from the database
 * @param {string} userPhone - User's phone number
 * @param {string} medicine - Medicine name
 * @returns {Promise<boolean>} - Success status
 */
deleteMedication: async (userPhone, medicine) => {
    try {
        // Delete from medications table
        const deleteParams = {
            TableName: DB_TABLES.MEDICATIONS_TABLE,
            Key: {
                userPhone: userPhone,
                medicine: medicine
            }
        };
        
        await dynamoDB.delete(deleteParams).promise();
        console.log(`✅ Deleted medication ${medicine} for user ${userPhone}`);
        
        // Delete associated reminders
        // First query for all reminders for this medication
        const reminderParams = {
            TableName: DB_TABLES.REMINDERS_TABLE,
            IndexName: "UserPhoneIndex",
            KeyConditionExpression: "userPhone = :phone",
            FilterExpression: "medicine = :med",
            ExpressionAttributeValues: { 
                ":phone": userPhone,
                ":med": medicine
            }
        };
        
        const reminders = await dynamoDB.query(reminderParams).promise();
        
        // Delete each reminder
        if (reminders.Items && reminders.Items.length > 0) {
            console.log(`Found ${reminders.Items.length} reminders to delete for ${medicine}`);
            
            for (const reminder of reminders.Items) {
                const reminderDeleteParams = {
                    TableName: DB_TABLES.REMINDERS_TABLE,
                    Key: {
                        reminderId: reminder.reminderId
                    }
                };
                
                await dynamoDB.delete(reminderDeleteParams).promise();
                console.log(`✅ Deleted reminder ${reminder.reminderId}`);
            }
        }
        
        return true;
    } catch (error) {
        console.error(`❌ Error deleting medication: ${error}`);
        return false;
    }
}
};

/**
 * Reminder-related database functions
 */
const ReminderModel = {
    /**
     * Create a medication reminder in the database
     * @param {string} userPhone - User's phone number
     * @param {string} medicine - Medicine name
     * @param {string} reminderTime - Time of the reminder
     * @returns {Promise<string|null>} - Reminder ID or null if failed
     */
    createReminder: async (userPhone, medicine, reminderTime = null) => {
        try {
            const reminderId = `${userPhone}_${medicine}_${Date.now()}`;
            const params = {
                TableName: DB_TABLES.REMINDERS_TABLE,
                Item: {
                    reminderId,
                    userPhone,
                    medicine,
                    createdAt: new Date().toISOString(),
                    status: 'sent',
                    responded: false,
                    reminderTime
                }
            };

            await dynamoDB.put(params).promise();
            return reminderId;
        } catch (error) {
            console.error(`❌ Error creating reminder: ${error}`);
            return null;
        }
    },

    /**
 * Update a reminder in the database
 * @param {string} reminderId - Reminder ID
 * @param {Object} updateData - Data to update
 * @returns {Promise<boolean>} - Success status
 */
updateReminder: async (reminderId, updateData) => {
    try {
        // Basic validation to prevent empty ExpressionAttributeNames
        const params = {
            TableName: DB_TABLES.REMINDERS_TABLE,
            Key: { reminderId },
            UpdateExpression: updateData.updateExpression,
            ExpressionAttributeValues: updateData.expressionAttributeValues
        };
        
        // Only add ExpressionAttributeNames if provided
        if (updateData.expressionAttributeNames && 
            Object.keys(updateData.expressionAttributeNames).length > 0) {
            params.ExpressionAttributeNames = updateData.expressionAttributeNames;
        }

        await dynamoDB.update(params).promise();
        return true;
    } catch (error) {
        console.error(`❌ Error updating reminder: ${error.message}`, error);
        return false;
    }
},

    /**
 * Get the latest reminder for a user
 * @param {string} userPhone - User's phone number
 * @returns {Promise<Object|null>} - Latest reminder or null if none
 */
    getLatestReminder: async (userPhone) => {
        try {
            const standardizedPhone = userPhone.replace('whatsapp:', '');
            const now = new Date();
            const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000); // Extend window to 30 minutes
            
            console.log(`Looking for latest reminder for ${standardizedPhone} since ${thirtyMinutesAgo.toISOString()}`);
            
            const params = {
                TableName: DB_TABLES.REMINDERS_TABLE,
                IndexName: "UserPhoneIndex",
                KeyConditionExpression: "userPhone = :phone",
                FilterExpression: "createdAt > :time AND responded = :r",
                ExpressionAttributeValues: { 
                    ":phone": standardizedPhone,
                    ":time": thirtyMinutesAgo.toISOString(),
                    ":r": false
                },
                ScanIndexForward: false, // Get most recent first
                Limit: 1
            };
            
            const result = await dynamoDB.query(params).promise();
            console.log(`Found ${result.Items ? result.Items.length : 0} recent reminders for ${userPhone}`);
            
            if (result.Items && result.Items.length > 0) {
                console.log(`Latest reminder details: ${JSON.stringify(result.Items[0])}`);
            }
            
            return (result.Items && result.Items.length > 0) ? result.Items[0] : null;
        } catch (error) {
            console.error(`❌ Error getting latest reminder: ${error}`);
            return null;
        }
    },

/**
     * Get the latest reminder for a user with improved time window and status tracking
     * @param {string} userPhone - User's phone number
     * @returns {Promise<Object|null>} - Latest reminder or null if none
     */
    getLatestReminder: async (userPhone) => {
        try {
            const standardizedPhone = userPhone.replace('whatsapp:', '');
            const now = new Date();
            // Extend time window to 60 minutes to be more lenient with response timing
            const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000);
            
            console.log(`Looking for latest reminder for ${standardizedPhone} since ${sixtyMinutesAgo.toISOString()}`);
            
            const params = {
                TableName: DB_TABLES.REMINDERS_TABLE,
                IndexName: "UserPhoneIndex",
                KeyConditionExpression: "userPhone = :phone",
                FilterExpression: "createdAt > :time AND (responded = :r OR attribute_not_exists(responded))",
                ExpressionAttributeValues: { 
                    ":phone": standardizedPhone,
                    ":time": sixtyMinutesAgo.toISOString(),
                    ":r": false
                },
                ScanIndexForward: false, // Get most recent first
                Limit: 1
            };
            
            const result = await dynamoDB.query(params).promise();
            console.log(`Found ${result.Items ? result.Items.length : 0} recent reminders for ${userPhone}`);
            
            if (result.Items && result.Items.length > 0) {
                console.log(`Latest reminder details: ${JSON.stringify(result.Items[0])}`);
            }
            
            return (result.Items && result.Items.length > 0) ? result.Items[0] : null;
        } catch (error) {
            console.error(`❌ Error getting latest reminder: ${error}`);
            return null;
        }
    },

    /**
     * Get ALL recent reminders for a user (both responded and unresponded)
     * @param {string} userPhone - User's phone number 
     * @param {number} minutesWindow - How many minutes back to look
     * @returns {Promise<Array>} - Array of recent reminders
     */
    getRecentReminders: async (userPhone, minutesWindow = 60) => {
        try {
            const standardizedPhone = userPhone.replace('whatsapp:', '');
            const now = new Date();
            const timeWindow = new Date(now.getTime() - minutesWindow * 60 * 1000);
            
            const params = {
                TableName: DB_TABLES.REMINDERS_TABLE,
                IndexName: "UserPhoneIndex",
                KeyConditionExpression: "userPhone = :phone",
                FilterExpression: "createdAt > :time",
                ExpressionAttributeValues: { 
                    ":phone": standardizedPhone,
                    ":time": timeWindow.toISOString()
                },
                ScanIndexForward: false // Get most recent first
            };
            
            const result = await dynamoDB.query(params).promise();
            return result.Items || [];
        } catch (error) {
            console.error(`❌ Error getting recent reminders: ${error}`);
            return [];
        }
    },

    /**
     * Mark a specific medication reminder as skipped due to conflict
     * @param {string} reminderId - Reminder ID
     * @param {string} conflictReason - Reason for skipping (e.g., "check-in conflict")
     * @returns {Promise<boolean>} - Success status
     */
    markReminderSkipped: async (reminderId, conflictReason) => {
        try {
            const params = {
                TableName: DB_TABLES.REMINDERS_TABLE,
                Key: { reminderId },
                UpdateExpression: "set responded = :r, #s = :s, conflictReason = :cr",
                ExpressionAttributeValues: { 
                    ":r": true,
                    ":s": "skipped",
                    ":cr": conflictReason
                },
                ExpressionAttributeNames: {
                    "#s": "status"
                }
            };

            await dynamoDB.update(params).promise();
            return true;
        } catch (error) {
            console.error(`❌ Error marking reminder as skipped: ${error}`);
            return false;
        }
    }
};


/**
 * Symptom-related database functions
 */
const SymptomModel = {
    /**
     * Save a symptom assessment
     * @param {string} userPhone - User's phone number
     * @param {Object} assessmentData - Assessment data to save
     * @returns {Promise<string>} - Assessment ID
     */
    saveAssessment: async (userPhone, assessmentData) => {
        try {
            const assessmentId = `${userPhone}_${Date.now()}`;
            const params = {
                TableName: DB_TABLES.SYMPTOMS_TABLE,
                Item: {
                    assessmentId,
                    userPhone,
                    primarySymptom: assessmentData.primarySymptom,
                    answers: assessmentData.answers,
                    assessment: assessmentData.assessment,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    followUps: [],
                    lastFollowUp: null,
                    nextFollowUpDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours later
                }
            };

            await dynamoDB.put(params).promise();
            console.log(`✅ Saved symptom assessment for ${userPhone}`);
            return assessmentId;
        } catch (error) {
            console.error(`❌ Error saving assessment: ${error}`);
            return null;
        }
    },

    /**
     * Get active symptom assessments for a user
     * @param {string} userPhone - User's phone number
     * @returns {Promise<Array>} - Active assessments
     */
    getActiveAssessments: async (userPhone) => {
        try {
            const params = {
                TableName: DB_TABLES.SYMPTOMS_TABLE,
                IndexName: "UserPhoneIndex",
                KeyConditionExpression: "userPhone = :phone",
                FilterExpression: "#status = :status",
                ExpressionAttributeValues: { 
                    ":phone": userPhone,
                    ":status": "active"
                },
                ExpressionAttributeNames: {
                    "#status": "status" 
                }
            };

            const result = await dynamoDB.query(params).promise();
            return result.Items || [];
        } catch (error) {
            console.error(`❌ Error getting active assessments: ${error}`);
            return [];
        }
    },

    /**
     * Add a follow-up record to a symptom assessment
     * @param {string} assessmentId - Assessment ID
     * @param {string} status - Follow-up status (improved/same/worse)
     * @param {string} notes - Additional notes
     * @returns {Promise<boolean>} - Success status
     */
    addFollowUp: async (assessmentId, status, notes = null) => {
        try {
            const now = new Date();
            const followUp = {
                date: now.toISOString(),
                status,
                notes
            };

            // Calculate next follow-up date (24 hours later if continuing, null if completed)
            const nextFollowUpDate = status === 'completed' ? 
                null : new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
            
            // Update assessment with new follow-up
            const params = {
                TableName: DB_TABLES.SYMPTOMS_TABLE,
                Key: { assessmentId },
                UpdateExpression: "set followUps = list_append(if_not_exists(followUps, :empty_list), :followUp), lastFollowUp = :now, nextFollowUpDate = :next, #status = :status",
                ExpressionAttributeValues: {
                    ":followUp": [followUp],
                    ":empty_list": [],
                    ":now": now.toISOString(),
                    ":next": nextFollowUpDate,
                    ":status": status === 'completed' ? 'completed' : 'active'
                },
                ExpressionAttributeNames: {
                    "#status": "status"
                }
            };

            await dynamoDB.update(params).promise();
            return true;
        } catch (error) {
            console.error(`❌ Error adding follow-up: ${error}`);
            return false;
        }
    },

    /**
     * Get all assessments that need follow-up
     * @returns {Promise<Array>} - Assessments needing follow-up
     */
    getAssessmentsNeedingFollowUp: async () => {
        try {
            const now = new Date().toISOString();
            const params = {
                TableName: DB_TABLES.SYMPTOMS_TABLE,
                FilterExpression: "#status = :status AND nextFollowUpDate <= :now",
                ExpressionAttributeValues: { 
                    ":status": "active",
                    ":now": now
                },
                ExpressionAttributeNames: {
                    "#status": "status" 
                }
            };

            const result = await dynamoDB.scan(params).promise();
            return result.Items || [];
        } catch (error) {
            console.error(`❌ Error getting assessments needing follow-up: ${error}`);
            return [];
        }
    }
};


    /**
 * Check-in related database functions
 */
const CheckInModel = {
    /**
     * Save a check-in response to the database
     * @param {Object} checkInData - Check-in data to save
     * @returns {Promise<boolean>} - Success status
     */
    saveCheckIn: async (checkInData) => {
        try {
            const params = {
                TableName: DB_TABLES.CHECK_INS_TABLE,
                Item: {
                    ...checkInData,
                    createdAt: new Date().toISOString()
                }
            };

            await dynamoDB.put(params).promise();
            console.log(`✅ Saved check-in for ${checkInData.userId}`);
            return true;
        } catch (error) {
            console.error(`❌ Error saving check-in: ${error}`);
            return false;
        }
    },

    /**
     * Get recent check-ins for a user
     * @param {string} userId - User's phone number
     * @param {number} limit - Maximum number of check-ins to retrieve
     * @returns {Promise<Array>} - Recent check-ins
     */
    getRecentCheckIns: async (userId, limit = 5) => {
        try {
            const params = {
                TableName: DB_TABLES.CHECK_INS_TABLE,
                IndexName: "UserIdIndex",
                KeyConditionExpression: "userId = :uid",
                ExpressionAttributeValues: {
                    ":uid": userId
                },
                ScanIndexForward: false, // most recent first
                Limit: limit
            };
            
            const result = await dynamoDB.query(params).promise();
            return result.Items || [];
        } catch (error) {
            console.error(`❌ Error getting recent check-ins: ${error}`);
            return [];
        }
    },

   /**
 * Get today's check-ins for a user
 * @param {string} userId - User's phone number
 * @returns {Promise<Array>} - Today's check-ins
 */
getTodaysCheckIns: async (userId) => {
    try {
      const today = new Date();
      // Set time to midnight so we get everything from today's date forward
      today.setHours(0, 0, 0, 0);
  
      const params = {
        TableName: DB_TABLES.CHECK_INS_TABLE,
        IndexName: "UserIdIndex",          // GSI that has userId as partition key and timestamp as sort key
        // Query by userId and timestamp >= today's date
        KeyConditionExpression: "userId = :uid AND #ts >= :today",
        ExpressionAttributeNames: {
          "#ts": "timestamp"               // Alias 'timestamp' if it's a reserved word
        },
        ExpressionAttributeValues: {
          ":uid": userId,
          ":today": today.toISOString()
        }
      };
  
      // Execute the query
      const result = await dynamoDB.query(params).promise();
      return result.Items || [];
    } catch (error) {
      console.error(`❌ Error getting today's check-ins: ${error}`);
      return [];
    }
  },
  

    /**
     * Mark check-ins as reported
     * @param {Array} checkInIds - Array of check-in IDs
     * @param {string} reportId - ID of the report that includes these check-ins
     * @returns {Promise<boolean>} - Success status
     */
    markCheckInsAsReported: async (checkInIds, reportId) => {
        try {
            // Update each check-in in parallel
            const updatePromises = checkInIds.map(checkInId => {
                const params = {
                    TableName: DB_TABLES.CHECK_INS_TABLE,
                    Key: { checkInId },
                    UpdateExpression: "set reported = :r, reportedTo = :rp",
                    ExpressionAttributeValues: {
                        ":r": true,
                        ":rp": reportId
                    }
                };
                
                return dynamoDB.update(params).promise();
            });
            
            await Promise.all(updatePromises);
            console.log(`✅ Marked ${checkInIds.length} check-ins as reported`);
            return true;
        } catch (error) {
            console.error(`❌ Error marking check-ins as reported: ${error}`);
            return false;
        }
    }
};

/**
 * Daily reports database functions
 */
const ReportModel = {
    /**
     * Save a daily report to the database
     * @param {Object} reportData - Report data to save
     * @returns {Promise<boolean>} - Success status
     */
    saveReport: async (reportData) => {
        try {
            const params = {
                TableName: DB_TABLES.DAILY_REPORTS_TABLE,
                Item: {
                    ...reportData,
                    createdAt: new Date().toISOString()
                }
            };

            await dynamoDB.put(params).promise();
            console.log(`✅ Saved report for caregiver ${reportData.caregiverId} about elderly ${reportData.elderlyId}`);
            return true;
        } catch (error) {
            console.error(`❌ Error saving report: ${error}`);
            return false;
        }
    },

    /**
     * Get reports for a specific caregiver and elderly pair
     * @param {string} caregiverId - Caregiver's phone number
     * @param {string} elderlyId - Elderly's phone number
     * @param {number} limit - Maximum number of reports to retrieve
     * @returns {Promise<Array>} - Recent reports
     */
    getRecentReports: async (caregiverId, elderlyId, limit = 7) => {
        try {
            // First part of the reportId is caregiverId_elderlyId
            const reportIdPrefix = `${caregiverId}_${elderlyId}`;
            
            const params = {
                TableName: DB_TABLES.DAILY_REPORTS_TABLE,
                FilterExpression: "begins_with(reportId, :prefix)",
                ExpressionAttributeValues: {
                    ":prefix": reportIdPrefix
                },
                ScanIndexForward: false, // most recent first
                Limit: limit
            };
            
            const result = await dynamoDB.scan(params).promise();
            return result.Items || [];
        } catch (error) {
            console.error(`❌ Error getting recent reports: ${error}`);
            return [];
        }
    },

    /**
     * Get a specific report by ID
     * @param {string} reportId - Report ID
     * @returns {Promise<Object|null>} - Report data or null if not found
     */
    getReportById: async (reportId) => {
        try {
            const params = {
                TableName: DB_TABLES.DAILY_REPORTS_TABLE,
                Key: { reportId }
            };
            
            const result = await dynamoDB.get(params).promise();
            return result.Item || null;
        } catch (error) {
            console.error(`❌ Error getting report by ID: ${error}`);
            return null;
        }
    }
};

module.exports = {
    UserModel,
    RelationshipModel,
    MedicationModel,
    ReminderModel,
    SymptomModel,
    CheckInModel,
    ReportModel
};