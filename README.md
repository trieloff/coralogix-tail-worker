# Coralogix Tail Worker

A Cloudflare Tail Worker that receives log events from other Cloudflare Workers and forwards them to the Coralogix Singles API for centralized log management.

## Features

- **Real-time Log Processing**: Receives tail events from Cloudflare Workers in real-time
- **Coralogix Integration**: Forwards logs to Coralogix Singles API with proper formatting
- **Faithful Fastly Conversion**: Uses `tailEvent2fastly()` function based on reference implementation
- **CF-Ray ID Threading**: Uses CF-Ray ID as threadId for better request tracing
- **Explicit Data Handling**: Shows undefined values instead of masking with fallback strings
- **Node.js Testing**: Includes comprehensive test suite using `node --test`
- **Batch Processing**: Efficiently batches logs to minimize API calls to Coralogix
- **Environment Support**: Supports multiple environments (staging, production)

## Setup

### Prerequisites

- Cloudflare account with Workers enabled
- Coralogix account with API access
- Node.js and npm installed locally

### Installation

1. **Install Dependencies**:
```bash
# Install Node.js dependencies
npm install

# Install Wrangler CLI globally (if not already installed)
npm install -g wrangler
```

2. **Authenticate with Cloudflare**:
```bash
# Login to Cloudflare
wrangler login
```

3. **Get Your Coralogix API Key**:
   - Log into your Coralogix account
   - Go to Settings → Send Your Data
   - Copy your "Send-Your-Data API Key"

4. **Configure API Key**:
```bash
# Set your Coralogix API key
wrangler secret put CORALOGIX_API_KEY
# Enter your API key when prompted
```

5. **Test Configuration**:
```bash
# Test your setup
npm run test:setup

# Deploy to staging for testing
npm run deploy:staging
```

### Configuration

| Variable | Type | Description | Value |
|----------|------|-------------|-------|
| `CORALOGIX_API_KEY` | Secret | Your Coralogix Send-Your-Data API key | Set via `wrangler secret put` |
| `CORALOGIX_ENDPOINT` | Variable | Coralogix Singles API endpoint | `https://ingress.eu1.coralogix.com/logs/v1/singles` |
| `APPLICATION_NAME` | Variable | Default application name for logs | `cloudflare-tail` |
| `SUBSYSTEM_NAME` | Variable | Fallback subsystem name (uses source worker name by default) | `unknown-worker` |

### Coralogix Configuration

The worker is currently configured for the EU1 region (`eu1.coralogix.com`). To use a different region, update the `CORALOGIX_ENDPOINT` variable in `wrangler.toml`:

- **US1**: `https://ingress.us1.coralogix.com/logs/v1/singles`
- **US2**: `https://ingress.us2.coralogix.com/logs/v1/singles`
- **EU1**: `https://ingress.eu1.coralogix.com/logs/v1/singles`
- **EU2**: `https://ingress.eu2.coralogix.com/logs/v1/singles`
- **AP1**: `https://ingress.ap1.coralogix.com/logs/v1/singles`
- **AP2**: `https://ingress.ap2.coralogix.com/logs/v1/singles`
- **AP3**: `https://ingress.ap3.coralogix.com/logs/v1/singles`

## Deployment

### Development
```bash
npm run dev
```

### Staging
```bash
npm run deploy:staging
```

### Production
```bash
npm run deploy:production
```

## Usage

### Configuring Source Workers

To have other workers send their logs to this tail worker, you have several options:

#### Option A: Using Wrangler Configuration

Add this to your source worker's `wrangler.toml`:

```toml
[[tail_consumers]]
service = "coralogix-tail-worker-production"  # or -staging, -dev
```

#### Option B: Using Cloudflare Dashboard

1. Go to the Cloudflare Workers dashboard
2. Select your source worker
3. Go to Settings → Triggers
4. Add a Tail Consumer
5. Enter the name of your tail worker:
   - Production: `coralogix-tail-worker-production`
   - Staging: `coralogix-tail-worker-staging`
   - Development: `coralogix-tail-worker-dev`

#### Option C: Using Wrangler CLI

```bash
# Add tail consumer to an existing worker
wrangler tail add <source-worker-name> <tail-worker-name>
```

### Verify Logs in Coralogix

1. Log into your Coralogix account
2. Go to the Logs section
3. Look for logs with:
   - Application Name: The value you set for `APPLICATION_NAME` (or "cloudflare-tail")
   - Subsystem Name: The name of your source worker (e.g., "forward", "my-worker")

### Log Types Captured

The tail worker captures and forwards:

1. **Console Logs**: `console.log()`, `console.error()`, `console.warn()`, etc.
2. **Exceptions**: Unhandled errors and exceptions
3. **HTTP Events**: Request/response data from fetch events (converted using `tailEvent2fastly()` function)

### Severity Mapping

JavaScript console levels are mapped to Coralogix severity levels:

| Console Level | Coralogix Severity | Description |
|---------------|-------------------|-------------|
| `debug` | 1 | Debug |
| `info`, `log` | 3 | Info |
| `warn` | 4 | Warn |
| `error` | 5 | Error |

## Log Format

Logs sent to Coralogix follow this structure:

```json
{
  "timestamp": 1675148539123,
  "applicationName": "cloudflare-tail",
  "subsystemName": "my-worker",
  "computerName": "my-worker",
  "severity": 3,
  "text": "Log message or JSON data",
  "category": "console|exception|fetch",
  "className": "TailWorker",
  "methodName": "log|error|fetch",
  "threadId": "cf-ray-id-or-worker-name"
}
```

**Key Fields:**
- **subsystemName**: The name of the producing worker (source of the logs)
- **computerName**: Also set to the producing worker name
- **applicationName**: Set to "cloudflare-tail" (configurable via `APPLICATION_NAME`)
- **category**: Type of log (`console`, `exception`, `fetch`)
- **severity**: Mapped from JavaScript console levels to Coralogix severity levels
- **threadId**: Uses CF-Ray ID when available for better request tracing, falls back to worker name
- **Explicit Undefined Handling**: No fallback strings that mask missing data - shows actual undefined values for debugging

## Fetch Event Conversion

The worker uses a `tailEvent2fastly()` function that faithfully converts Cloudflare tail events to Fastly-style JSON logs. This function is based on the `cloudflare2fastly()` reference implementation but adapted for tail event data structure instead of logpush data.

### Key Differences from Logpush

- **Data Source**: Tail events vs. logpush events have different structures
- **Field Mapping**: Tail events use `request.cf` object vs. logpush top-level fields
- **Header Processing**: Tail events have `request.headers` object vs. logpush `RequestHeaders`
- **Timing Data**: Tail events provide `wallTime` vs. logpush timestamp fields

### Testing

Run the conversion tests:

```bash
npm test
# or
node --test test-tail-conversion.js
```

The test suite validates:
- ✅ Proper structure conversion from tail events to Fastly format
- ✅ Geographic data mapping (lat/lon, ASN, city, country)
- ✅ Header name conversion (hyphens to underscores)
- ✅ Error handling for missing or invalid data

## Troubleshooting

### Common Issues

1. **"Missing required environment variables"**
   - Make sure you've set `CORALOGIX_API_KEY`: `wrangler secret put CORALOGIX_API_KEY`
   - Verify the secret is set: `wrangler secret list`

2. **"Failed to send logs to Coralogix"**
   - Check your API key is correct
   - Verify the endpoint in `wrangler.toml` matches your Coralogix region
   - Check the Coralogix API status

3. **No logs appearing in Coralogix**
   - Verify your source workers are configured with tail consumers
   - Check the tail worker logs: `wrangler tail coralogix-tail-worker-production` (or -staging, -dev)
   - Ensure your source workers are generating logs

4. **Rate limiting errors**
   - The worker automatically batches requests to avoid rate limits
   - If you're still hitting limits, consider reducing the batch size in the code

### Debug Commands

```bash
# View tail worker logs (choose your environment)
wrangler tail coralogix-tail-worker-production
wrangler tail coralogix-tail-worker-staging
wrangler tail coralogix-tail-worker-dev

# View source worker logs
wrangler tail <your-source-worker-name>

# Check worker status
wrangler status

# List configured secrets
wrangler secret list

# Test setup
npm run test:setup
```

### CDN-Style Fetch Logs

Fetch events are formatted as CDN-style logs with **100% structure compatibility** with standard CDN formats (like Fastly):

```json
{
  "request": {
    "method": "GET",
    "host": "example.com",
    "url": "/api/data",
    "qs": "param=value",
    "protocol": "HTTP/2",
    "backend": "cloudflare_worker",
    "restarts": 0,
    "body_size": 0,
    "headers": {
      "accept_encoding": "gzip, deflate",
      "accept_language": "en-US,en;q=0.9",
      "user_agent": "Mozilla/5.0...",
      "referer": "https://example.com/page",
      "cdn_loop": null,
      "if_modified_since": null,
      "x_forwarded_for": "203.0.113.1",
      "x_forwarded_host": "example.com",
      "fastly_ff": null,
      "fastly_orig_accept_encoding": null,
      "x_byo_cdn_type": null,
      "x_push_invalidation": null
    }
  },
  "response": {
    "status": "200",
    "body_size": 0,
    "headers": {
      "cache_control": "max-age=3600",
      "vary": "Accept-Encoding",
      "surrogate_control": "max-age=7200"
    }
  },
  "helix": {
    "request_type": "dynamic",
    "backend_type": "cloudflare",
    "contentbus_prefix": "live"
  },
  "client": {
    "name": "Google LLC",
    "number": 15169,
    "city_name": "San Francisco",
    "country_name": "United States",
    "ip": "203.0.113.1"
  },
  "cdn": {
    "originating_ip_geoip": {
      "ip": "203.0.113.1",
      "ip_ipaddr": "203.0.113.1",
      "location_geopoint": {
        "lat": 37.7749,
        "lon": -122.4194
      },
      "continent_name": "North America",
      "country_name": "United States",
      "city_name": "San Francisco",
      "postal_code": "94102",
      "is_local": false,
      "asn": {
        "number": "15169",
        "organization": "Google LLC"
      }
    },
    "version": "1",
    "url": "https://example.com/api/data?param=value",
    "originating_ip": "203.0.113.1",
    "time_elapsed_msec": 45.2,
    "is_edge": true,
    "datacenter": "SFO",
    "region_code": "US-West",
    "cache_status": "HIT",
    "cache_ttl": 3600
  }
}
```

**Key Features:**
- ✅ **100% Structure Match**: Identical field names and nesting to standard CDN formats
- ✅ **Underscore Field Names**: Uses `accept_encoding`, `user_agent`, etc. (not hyphens)
- ✅ **Complete Geographic Data**: Full `originating_ip_geoip` with lat/lon, ASN, etc.
- ✅ **CDN Compatibility**: Includes Fastly-specific fields (null for Cloudflare)
- ✅ **Rich Client Data**: ASN organization, city/country names, IP details
- ✅ **Explicit Undefined Values**: No fallback strings that mask missing data - undefined shows as undefined

## Monitoring

The tail worker itself logs its operations:
- Successful log transmissions to Coralogix
- API errors and failures
- Configuration issues

Monitor these logs in the Cloudflare Workers dashboard or by tailing this worker itself.

## Troubleshooting

### Common Issues

1. **Missing API Key**: Ensure `CORALOGIX_API_KEY` is set correctly
2. **Wrong Endpoint**: Verify `CORALOGIX_ENDPOINT` in `wrangler.toml` matches your Coralogix region
3. **Rate Limits**: The worker batches requests to avoid hitting Coralogix API limits
4. **Large Payloads**: Individual batches are limited to ~2MB (approximately 3,000 medium-sized logs)

### Debug Mode

Enable debug logging by checking the Cloudflare Workers dashboard logs or using:

```bash
wrangler tail coralogix-tail-worker-production  # or -staging, -dev
```

## License

MIT License - see LICENSE file for details.
