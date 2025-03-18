// config/config.js - Configuration settings
const AWS = require('aws-sdk');
const openai = require('openai');
const twilio = require('twilio');

// Configure AWS
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

const DB_TABLES = {
    MEDICATIONS_TABLE: 'sukoon_saarthi_users', 
    REMINDERS_TABLE: 'MedicationReminders',
    USERS_TABLE: 'SukoonUsers',
    RELATIONSHIPS_TABLE: 'UserRelationships',
    SYMPTOMS_TABLE: 'SymptomAssessments',
    CHECK_INS_TABLE: 'SukoonCheckIns',  
    DAILY_REPORTS_TABLE: 'SukoonReports' 
};

// Create clients
const createDynamoDBClient = () => new AWS.DynamoDB.DocumentClient();
const dynamoDB = createDynamoDBClient();

const createTwilioClient = () => twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

const createOpenAIClient = () => new openai.OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

module.exports = {
    DB_TABLES,
    dynamoDB,
    createDynamoDBClient,
    createTwilioClient,
    createOpenAIClient
};