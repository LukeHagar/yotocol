#!/usr/bin/env node

import { NFC } from 'nfc-pcsc';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import ndefPkg from '@taptrack/ndef';
const { Ndef } = ndefPkg;

const nfc = new NFC();

console.log(nfc)

async function main() {
  console.clear();
  p.intro(pc.blue('🔍 Yoto Card Reader'));
  
  const s = p.spinner();
  s.start('Initializing NFC reader...');

  nfc.on('reader', async (reader) => {
    s.stop('NFC reader ready');
    
    reader.on('card', async (card) => {
      try {
        // Read the card's UID
        const uid = card.uid;
        p.note(`Card UID: ${uid}`, 'Card Detected');

        // Read NDEF data if available
        const data = await reader.read(4, 12);
        const ndefMessage = Ndef.decodeMessage(data);
        
        if (ndefMessage && ndefMessage.length > 0) {
          p.note(JSON.stringify(ndefMessage, null, 2), 'Card Contents');
          
          // Save the data to a file
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `yoto-card-${uid}-${timestamp}.json`;
          
          const fs = await import('fs/promises');
          await fs.writeFile(filename, JSON.stringify({
            uid,
            timestamp: new Date().toISOString(),
            data: ndefMessage
          }, null, 2));
          
          p.note(`Data saved to ${filename}`, 'Success');
        } else {
          p.note('No NDEF data found on card', 'Info');
        }
      } catch (err) {
        p.log.error(`Error reading card: ${err.message}`);
      }
    });

    reader.on('error', (err) => {
      p.log.error(`Reader error: ${err.message}`);
    });

    reader.on('end', () => {
      p.log.error('Reader disconnected');
    });
  });

  nfc.on('error', (err) => {
    s.stop('Error initializing NFC');
    p.log.error(`NFC error: ${err.message}`);
    process.exit(1);
  });
}

main().catch((err) => {
  p.log.error(`Fatal error: ${err.message}`);
  process.exit(1);
}); 