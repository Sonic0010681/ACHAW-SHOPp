const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');

/**
 * Connects to IMAP and retrieves the most recent 6-digit OpenAI verification code.
 */
async function getLatestOpenAICode({ host, port, user, password }) {
  if (!host || !user || !password) {
    throw new Error('IMAP yapılandırması eksik!');
  }

  const config = {
    imap: {
      user,
      password,
      host,
      port: parseInt(port) || 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }, // Avoid self-signed cert issues
      authTimeout: 8000
    }
  };

  let connection;
  try {
    connection = await imaps.connect(config);
    await connection.openBox('INBOX');

    // Fetch the last 10 messages from Inbox
    const searchCriteria = ['ALL'];
    const fetchOptions = {
      bodies: [''],
      struct: true
    };

    const messages = await connection.search(searchCriteria, fetchOptions);
    if (!messages || messages.length === 0) {
      connection.end();
      return null;
    }

    // Sort newest messages first (by UID)
    messages.sort((a, b) => b.attributes.uid - a.attributes.uid);
    const scanLimit = Math.min(messages.length, 10);
    const messagesToScan = messages.slice(0, scanLimit);

    for (const msg of messagesToScan) {
      const allPart = msg.parts.find(part => part.which === '');
      if (!allPart) continue;

      const parsed = await simpleParser(allPart.body);
      const subject = parsed.subject || '';
      const text = parsed.text || '';
      const html = parsed.html || '';
      const from = parsed.from ? parsed.from.text : '';
      const date = parsed.date || msg.attributes.date;

      // Verify if email is OpenAI login or verification related
      const isRelevant = 
        from.toLowerCase().includes('openai') || 
        subject.toLowerCase().includes('openai') || 
        subject.toLowerCase().includes('verification') || 
        text.toLowerCase().includes('openai') ||
        text.toLowerCase().includes('verification code') ||
        html.toLowerCase().includes('verification code');

      if (isRelevant) {
        // Find 6-digit code
        const codeRegex = /\b\d{6}\b/;
        const match = text.match(codeRegex) || html.match(codeRegex) || subject.match(codeRegex);
        if (match) {
          connection.end();
          return {
            code: match[0],
            subject,
            from,
            date
          };
        }
      }
    }

    connection.end();
    return null;
  } catch (error) {
    if (connection) {
      try { connection.end(); } catch (e) {}
    }
    throw error;
  }
}

module.exports = { getLatestOpenAICode };
