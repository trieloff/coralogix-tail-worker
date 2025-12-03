import { test } from 'node:test';
import assert from 'node:assert';

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

// Load the raw tail event structure
import rawTailEvent from './fixtures/raw-tail-event.json' with { type: 'json' };

test('tailEvent2fastly converts tail event to Fastly format', () => {
  const result = tailEvent2fastly(rawTailEvent);
  
  // Basic structure checks
  assert(result !== null, 'Should return a valid result');
  assert(typeof result === 'object', 'Should return an object');
  
  // Check main sections exist
  assert(result.request, 'Should have request section');
  assert(result.response, 'Should have response section');
  assert(result.helix, 'Should have helix section');
  assert(result.client, 'Should have client section');
  assert(result.cdn, 'Should have cdn section');
  
  // Check request data
  assert.strictEqual(result.request.method, 'GET');
  assert.strictEqual(result.request.host, 'minivelos.bike');
  assert.strictEqual(result.request.url, '/bikes/lars-moulton-tsr');
  assert.strictEqual(result.request.protocol, 'HTTP/2');
  
  // Check response data
  assert.strictEqual(result.response.status, '200');
  
  // Check client data
  assert.strictEqual(result.client.name, '1&1 Versatel GmbH');
  assert.strictEqual(result.client.number, 8881);
  assert.strictEqual(result.client.city_name, 'Potsdam');
  assert.strictEqual(result.client.country_name, 'DE');
  
  // Check CDN data
  assert.strictEqual(result.cdn.datacenter, 'TXL');
  assert.strictEqual(result.cdn.url, 'https://minivelos.bike/bikes/lars-moulton-tsr');
  assert.strictEqual(result.cdn.time_elapsed_msec, 28);
  
  // Check geographic data
  assert.strictEqual(result.cdn.originating_ip_geoip.continent_name, 'EU');
  assert.strictEqual(result.cdn.originating_ip_geoip.country_name, 'DE');
  assert.strictEqual(result.cdn.originating_ip_geoip.city_name, 'Potsdam');
  assert.strictEqual(result.cdn.originating_ip_geoip.location_geopoint.lat, 52.39886);
  assert.strictEqual(result.cdn.originating_ip_geoip.location_geopoint.lon, 13.06566);
  
  // Check headers are converted to underscore format
  assert(result.request.headers.accept_encoding, 'Should have accept_encoding header');
  assert(result.request.headers.user_agent, 'Should have user_agent header');
  assert(result.request.headers.cf_connecting_ip, 'Should have cf_connecting_ip header');
  
  console.log('✅ All tests passed!');
  console.log('Converted result:', JSON.stringify(result, null, 2));
});

test('tailEvent2fastly handles missing request gracefully', () => {
  const invalidEvent = { event: {} };
  const result = tailEvent2fastly(invalidEvent);
  assert.strictEqual(result, null, 'Should return null for missing request');
});

test('tailEvent2fastly handles invalid URL gracefully', () => {
  const invalidEvent = {
    event: {
      request: {
        url: 'not-a-valid-url',
        headers: {}
      }
    }
  };
  const result = tailEvent2fastly(invalidEvent);
  assert.strictEqual(result, null, 'Should return null for invalid URL');
});
