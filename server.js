// server.js - Main application entry point
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');

// Import routes
const webhookRoutes = require('./routes/webhookRoutes');

// Import services
const reminderService = require('./services/reminderService');
const followUpService = require('./services/followUpService');
const checkInService = require('./services/checkInService');

const app = express();
const port = process.env.PORT || 3000;



// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use('/whatsapp-webhook', webhookRoutes);




// Start the services
reminderService.startReminderScheduler();
followUpService.startFollowUpScheduler();
checkInService.initializeCheckInScheduler();
checkInService.scheduleDailyReports();

/*
(async () => {
    try {
      console.log('Sending initial daily reports on startup...');
      await checkInService.sendDailyReports();
      console.log('Initial daily reports sent successfully');
    } catch (error) {
      console.error('Error sending initial daily reports:', error);
    }
  })();

  */

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('👋 Shutting down...');
    reminderService.stopReminderScheduler();
    followUpService.stopFollowUpScheduler();
    process.exit(0);
});

// Start the server
app.listen(port, () => {
    console.log(`🚀 Sukoon Saarthi backend running on http://localhost:${port}`);
});
	