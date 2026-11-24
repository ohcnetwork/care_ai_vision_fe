# Care AI Vision

AI-powered [CARE](https://github.com/ohcnetwork/care_fe) plugin for extracting information from scanned forms and diagnostic reports, then filling the relevant CARE fields.

## Install from the CARE App Store

AI Vision's App Store package provides the frontend plugin. It does not install
or configure the `care_filly` backend plugin, which is shared with Filly.

1. Create or obtain a [Medispeak account](https://medispeak.ohc.network) and ask Medispeak for the account API
	key and API base URL for your deployment.
2. Install and enable the `care_filly` backend plugin in your CARE backend
	deployment. Configure `MEDISPEAK_BASE_URL` and `MEDISPEAK_API_KEY` in the
	backend's `care_filly` plugin configuration (`PLUGIN_CONFIGS`) or backend
	environment. Run the plugin migrations and restart/deploy the backend as
	required by your deployment process.
3. Keep `MEDISPEAK_API_KEY` on the backend. Do not put it in the App Store
	frontend configuration, frontend environment, or a browser build. The
	backend uses it to create sessions and issue short-lived scoped tokens.
4. Install AI Vision from the CARE App Store. Set the frontend
	`MEDISPEAK_API_URL` plugin config to the Medispeak v2 API root. This is a
	public API URL, not the account secret. The package's backend health check
	is `/api/care_filly/healthz`; it requires the backend plugin to be present.
5. Grant the relevant users the `can_use_filly` facility permission. Each user
	must also enable AI Vision from their AI Vision user settings.

The health check confirms that the backend plugin is installed; it does not
validate the Medispeak credentials. Missing or invalid backend credentials
will prevent session creation.

## Features

- 📷 **Scan or upload** — pick an image from camera, gallery, or file picker
- 🤖 **Registration form autofill** — extract structured patient details and fill the patient registration form
- 🧪 **Diagnostic report extraction** — extract results into diagnostic report observations and optionally attach the scanned pages to the report
- 🏛️ **Governance resolution** — automatically resolves State → District → Local Body → Ward hierarchy via Care's Organization API
- ✅ **Auto-fills form fields** — name, phone, gender, DOB/age, blood group, address, pincode, and governance location
- 🔁 **Retry on failure** — reprocesses the same image without re-upload


## Getting Started

### Prerequisites

- A running [Care frontend](https://github.com/ohcnetwork/care_fe) instance to host this plugin
- A running [Care backend](https://github.com/ohcnetwork/care) with the [care_filly backend plugin](https://github.com/ohcnetwork/care_filly) installed and configured
- A Medispeak account with an API key and API base URL
- CARE users who need AI Vision must have the `can_use_filly` facility permission and enable AI Vision in their user settings

### Installation

```bash
git clone https://github.com/ohcnetwork/care_ai_vision_fe.git
cd care_ai_vision_fe
npm install
```

### Configuration

Set the Medispeak API root, either:

- `MEDISPEAK_API_URL` in this plugin's config in CARE (Admin → plugins) — no rebuild needed, or
- `REACT_MEDISPEAK_API_URL` in `.env` for local development (requires a rebuild)

Lab values below `LOW_CONFIDENCE_THRESHOLD` (plugin config) or `REACT_LOW_CONFIDENCE_THRESHOLD` (`.env`) are marked **Check this**. Default is `0.99`. Use `0.99` or `99`.

> care_filly holds the `MEDISPEAK_API_KEY` account secret and mints short-lived, session-scoped tokens. This plugin only ever talks to Medispeak with those scoped tokens.

### Development

```bash
npm start
```

This starts the dev server on port **10120** with hot reload.

### Production Build

```bash
npm run build
```

## How It Works

### Patient registration

1. User clicks "Scan Registration Form" on the patient registration page
2. Browser shows native image picker (camera / gallery / files)
3. care_filly creates a document-modality Medispeak session and mints a scoped token
4. The image is uploaded straight to Medispeak using that token and committed for OCR + structured extraction (a typed "form" output, not a freeform prompt)
5. The plugin polls the session until it reaches a terminal status, then reads back the structured fields
6. Extracted fields are validated and auto-filled into the form
7. Governance hierarchy (state/district/local body/ward) is resolved via Care's Organization API
8. User reviews extracted data and confirms

### Diagnostic reports

AI Vision can also scan diagnostic report pages, extract values into the
report's observation fields, and optionally attach the scanned pages to the
diagnostic report in CARE.

