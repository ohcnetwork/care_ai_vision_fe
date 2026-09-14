interface ImportMetaEnv {
  readonly REACT_MEDISPEAK_API_URL: string;
  readonly REACT_LOW_CONFIDENCE_THRESHOLD?: string;
  readonly REACT_OCR_CONTEXT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
