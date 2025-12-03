/**
 * Cloudflare Tail Worker for Coralogix Log Ingestion
 *
 * This worker receives tail events from other Cloudflare Workers and forwards
 * them to the Coralogix Singles API for log ingestion.
 */

// Severity mapping for Coralogix
const SEVERITY_MAP = {
  'debug': 1,
  'info': 3,
  'log': 3,
  'warn': 4,
  'error': 5
};

/**
 * Main tail handler - receives events from other Workers
 * @param {Array} events - Array of tail events
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 */
/**
 * Transforms Cloudflare tail event data to Fastly-style JSON log messages
 * Based on the cloudflare2fastly function from reference.js but adapted for tail events
 * @param {object} tailEvent - Cloudflare tail event
 * @returns {object} Fastly-style JSON log message
 */
function tailEvent2fastly(tailEvent) {
  const request = tailEvent.event?.request;
  const response = tailEvent.event?.response;
  const cf = request?.cf;
  const headers = request?.headers || {};
  const responseHeaders = response?.headers || {};

  if (!request) {
    return null; // No request data available
  }

  // Parse URL for detailed information
  let parsedUrl;
  try {
    parsedUrl = new URL(request.url);
  } catch (e) {
    return null; // Invalid URL
  }

  return {
    request: {
      method: request.method,
      host: headers.host || parsedUrl.hostname,
      url: parsedUrl.pathname,
      qs: parsedUrl.search.replace('?', ''),
      protocol: cf?.httpProtocol,
      backend: 'cloudflare_worker',
      restarts: 0,
      body_size: 0,
      headers: Object.entries(headers).reduce((acc, [key, value]) => {
        acc[key.toLowerCase().replace(/-/g, '_')] = value;
        return acc;
      }, {})
    },
    response: {
      status: response?.status?.toString(),
      body_size: 0,
      headers: Object.entries(responseHeaders).reduce((acc, [key, value]) => {
        acc[key.toLowerCase().replace(/-/g, '_')] = value;
        return acc;
      }, {})
    },
    helix: {
      request_type: 'dynamic',
      backend_type: 'cloudflare',
      contentbus_prefix: 'live'
    },
    client: {
      name: cf?.asOrganization,
      number: cf?.asn,
      city_name: cf?.city,
      country_name: cf?.country,
      ip: cf?.ip || headers['cf-connecting-ip']
    },
    cdn: {
      originating_ip_geoip: {
        ip: cf?.ip || headers['cf-connecting-ip'],
        ip_ipaddr: cf?.ip || headers['cf-connecting-ip'],
        location_geopoint: {
          lat: parseFloat(cf?.latitude) || undefined,
          lon: parseFloat(cf?.longitude) || undefined
        },
        continent_name: cf?.continent,
        country_name: cf?.country,
        city_name: cf?.city,
        postal_code: cf?.postalCode,
        is_local: false,
        asn: {
          number: cf?.asn?.toString(),
          organization: cf?.asOrganization
        }
      },
      version: '1',
      url: request.url,
      originating_ip: cf?.ip || headers['cf-connecting-ip'],
      time_elapsed_msec: tailEvent.wallTime,
      is_edge: true,
      datacenter: cf?.colo,
      region_code: cf?.regionCode,
      cache_status: responseHeaders['cf-cache-status'],
      cache_ttl: 0
    }
  };
}

export default {
  async tail(events, env, ctx) {
    // Validate required environment variables
    if (!env.CORALOGIX_API_KEY || !env.CORALOGIX_ENDPOINT) {
      console.error('Missing required environment variables: CORALOGIX_API_KEY and CORALOGIX_ENDPOINT');
      return;
    }

    // Process events in batches to avoid hitting API limits
    const batchSize = 100; // Coralogix recommends batching for efficiency
    const batches = [];

    for (let i = 0; i < events.length; i += batchSize) {
      batches.push(events.slice(i, i + batchSize));
    }

    // Process each batch
    for (const batch of batches) {
      const logs = [];

      for (const event of batch) {
        // Process console logs
        if (event.logs) {
          for (const log of event.logs) {
            logs.push(createCoralogixLog(log, event, env, 'console'));
          }
        }

        // Process exceptions
        if (event.exceptions) {
          for (const exception of event.exceptions) {
            logs.push(createCoralogixLog(exception, event, env, 'exception'));
          }
        }

        // Process fetch events (HTTP requests/responses)
        if (event.event && event.event.request) {
          logs.push(createCoralogixLog(event.event, event, env, 'fetch'));
        }
      }

      if (logs.length > 0) {
        // Use waitUntil to ensure the request completes even if the worker finishes
        ctx.waitUntil(sendToCoralogix(logs, env));
      }
    }
  }
};

/**
 * Create a Coralogix-formatted log entry
 * @param {Object} logData - The log data (console log, exception, or fetch event)
 * @param {Object} event - The tail event
 * @param {Object} env - Environment variables
 * @param {string} type - Type of log ('console', 'exception', 'fetch')
 * @returns {Object} Coralogix log entry
 */
// Helper function to get value and log when missing
function getValueOrLog(value, fieldName, context = '') {
  if (value !== undefined && value !== null && value !== '') {
    return value;
  }

  // Log missing data for debugging (but don't spam)
  if (Math.random() < 0.1) { // Only log 10% of missing values to avoid spam
    console.warn(`Missing ${fieldName}${context ? ` in ${context}` : ''}`);
  }

  return null;
}

// Extract CF-Ray ID from various sources for use as threadId
function extractRayId(event, logData) {
  // Try to get CF-Ray from different sources
  const request = event.event?.request || logData.request;
  if (!request) {
    console.warn('No request object found in event or logData');
    return undefined;
  }

  const requestHeaders = request.headers;
  if (!requestHeaders) {
    console.warn('No headers found in request object');
    return undefined;
  }

  // Check for cf-ray header (most common)
  const cfRayHeader = getValueOrLog(requestHeaders['cf-ray'], 'cf-ray header', 'request headers');
  if (cfRayHeader) {
    return cfRayHeader;
  }

  // Check for CF-Ray in the cf object
  const cfRayObject = getValueOrLog(request.cf?.ray, 'cf.ray', 'cf object');
  if (cfRayObject) {
    return cfRayObject;
  }

  // Check in the event itself
  const eventRayId = getValueOrLog(event.rayId, 'rayId', 'event');
  if (eventRayId) {
    return eventRayId;
  }

  console.warn('CF-Ray ID not found in any expected location');
  return undefined;
}

function createCoralogixLog(logData, event, env, type) {
  const timestamp = logData.timestamp || Date.now();

  // Base log structure for Coralogix Singles API
  const rayId = extractRayId(event, logData);
  const scriptName = event.scriptName;

  if (!scriptName) {
    console.warn('Missing scriptName in event');
  }

  const log = {
    timestamp: timestamp,
    applicationName: env.APPLICATION_NAME || 'cloudflare-tail', // This fallback is OK - it's our config
    subsystemName: scriptName || env.SUBSYSTEM_NAME, // No fallback - let undefined show
    computerName: scriptName, // No fallback - let undefined show
    severity: 3, // Default to Info
    text: '',
    category: type,
    className: 'TailWorker',
    threadId: rayId || scriptName // Use rayId first, then scriptName, but no string fallback
  };

  // Format the log based on type
  switch (type) {
    case 'console':
      log.severity = SEVERITY_MAP[logData.level] || 3;
      log.text = formatConsoleMessage(logData.message);
      log.methodName = logData.level;
      break;

    case 'exception':
      log.severity = 5; // Error
      log.text = JSON.stringify({
        name: logData.name,
        message: logData.message,
        timestamp: logData.timestamp
      });
      log.className = logData.name; // Let undefined show if missing
      log.methodName = 'exception';
      break;

    case 'fetch':
      // Use the new tailEvent2fastly function for faithful conversion
      const fastlyLog = tailEvent2fastly(event);

      if (!fastlyLog) {
        console.warn('Failed to convert tail event to Fastly format');
        log.text = 'Failed to convert fetch event';
        break;
      }

      log.text = JSON.stringify(fastlyLog);
      log.methodName = 'fetch';

      // Set severity based on response status
      const status = fastlyLog.response?.status;
      if (status) {
        const statusCode = parseInt(status);
        if (statusCode >= 500) {
          log.severity = 5; // Error
        } else if (statusCode >= 400) {
          log.severity = 4; // Warning
        } else {
          log.severity = 3; // Info
        }
      }
      break;

  }

  return log;
}

/**
 * Format console message array into a string
 * @param {Array} message - Console message array
 * @returns {string} Formatted message
 */
function formatConsoleMessage(message) {
  if (!Array.isArray(message)) {
    return String(message);
  }

  return message.map(item => {
    if (typeof item === 'object') {
      return JSON.stringify(item);
    }
    return String(item);
  }).join(' ');
}

/**
 * Send logs to Coralogix Singles API
 * @param {Array} logs - Array of Coralogix log entries
 * @param {Object} env - Environment variables
 */
async function sendToCoralogix(logs, env) {
  const url = env.CORALOGIX_ENDPOINT;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.CORALOGIX_API_KEY}`
      },
      body: JSON.stringify(logs)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to send logs to Coralogix: ${response.status} ${response.statusText}`, errorText);
    } else {
      console.log(`Successfully sent ${logs.length} logs to Coralogix`);
    }
  } catch (error) {
    console.error('Error sending logs to Coralogix:', error);
  }
}
