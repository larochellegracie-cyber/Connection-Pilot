function escapeXml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

export function voiceTwimlDocument(businessName: string): string {
  return `<Response><Say>Hi, thanks for calling ${escapeXml(businessName)}. What can we help with today? Go ahead and leave us a message after the tone.</Say><Record maxLength="120" playBeep="true" recordingStatusCallback="https://connectionpilot.net/api/webhooks/twilio/recording" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" transcribe="true" transcribeCallback="https://connectionpilot.net/api/webhooks/twilio/transcript" transcribeCallbackMethod="POST" /></Response>`;
}
