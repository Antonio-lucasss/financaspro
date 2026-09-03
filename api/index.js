/**
 * FinançasPro — Vercel Serverless Function Entrypoint
 * Exposes the Express app as a serverless handler for Vercel.
 */

const app = require('../server');

module.exports = app;
