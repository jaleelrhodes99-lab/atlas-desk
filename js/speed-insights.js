/**
 * Vercel Speed Insights initialization
 * This script initializes Vercel Speed Insights for tracking web vitals
 */

// Import the injectSpeedInsights function from the Speed Insights package
import { injectSpeedInsights } from '../node_modules/@vercel/speed-insights/dist/index.mjs';

// Initialize Speed Insights when the page loads
if (typeof window !== 'undefined') {
  // Only track in production (when deployed to Vercel)
  // The package automatically detects the environment
  injectSpeedInsights();
}
