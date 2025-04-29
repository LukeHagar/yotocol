#!/usr/bin/env node

import { NFC } from 'nfc-pcsc';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import ndef from '@taptrack/ndef';
import filenamify from 'filenamify';
import { existsSync } from 'fs';

const nfc = new NFC();
let currentReader = null;

// URI prefix codes as defined in NFC Forum URI Record Type Definition
const URI_PREFIXES = {
  0x00: '',
  0x01: 'http://www.',
  0x02: 'https://www.',
  0x03: 'http://',
  0x04: 'https://',
  0x05: 'tel:',
  0x06: 'mailto:',
  0x07: 'ftp://anonymous:anonymous@',
  0x08: 'ftp://ftp.',
  0x09: 'ftps://',
  0x0A: 'sftp://',
  0x0B: 'smb://',
  0x0C: 'nfs://',
  0x0D: 'ftp://',
  0x0E: 'dav://',
  0x0F: 'news:',
  0x10: 'telnet://',
  0x11: 'imap:',
  0x12: 'rtsp://',
  0x13: 'urn:',
  0x14: 'pop:',
  0x15: 'sip:',
  0x16: 'sips:',
  0x17: 'tftp:',
  0x18: 'btspp://',
  0x19: 'btl2cap://',
  0x1A: 'btgoep://',
  0x1B: 'tcpobex://',
  0x1C: 'irdaobex://',
  0x1D: 'file://',
  0x1E: 'urn:epc:id:',
  0x1F: 'urn:epc:tag:',
  0x20: 'urn:epc:pat:',
  0x21: 'urn:epc:raw:',
  0x22: 'urn:epc:',
  0x23: 'urn:nfc:'
};

// Helper function to parse NDEF URI record
function parseUriRecord(data) {
  if (data.length < 2) return null;
  
  // The first byte is the prefix code
  const prefixCode = data[0];
  console.log('URI prefix code:', prefixCode.toString(16).padStart(2, '0'));
  
  // The rest is the URI data
  const uriData = data.slice(1);
  console.log('URI data hex:', uriData.toString('hex'));
  
  const prefix = URI_PREFIXES[prefixCode] || '';
  const uri = uriData.toString('utf8');
  
  return {
    prefixCode,
    prefix,
    uri,
    fullUri: prefix + uri,
    raw: {
      prefixCode,
      uriData: uriData.toString('hex')
    }
  };
}

// Helper function to find NDEF message in raw data
function findNdefMessage(data) {
  // Look for NDEF TLV (Type-Length-Value) structure
  // TLV format: [Type (1 byte)][Length (1 byte)][Value (Length bytes)]
  const ndefTlv = 0x03; // NDEF Message TLV
  const terminatorTlv = 0xFE; // Terminator TLV
  
  let offset = 0;
  while (offset < data.length) {
    const type = data[offset];
    if (type === ndefTlv) {
      const length = data[offset + 1];
      const value = data.slice(offset + 2, offset + 2 + length);
      return value;
    } else if (type === terminatorTlv) {
      break;
    }
    offset++;
  }
  return null;
}

// Helper function to decode payload
function decodePayload(payload) {
  // Split the comma-separated string into numbers
  const numbers = payload.split(',').map(num => parseInt(num.trim(), 10));
  
  // The first byte is the URI prefix code
  const prefixCode = numbers[0];
  const prefix = URI_PREFIXES[prefixCode] || '';
  
  // Convert remaining numbers to characters
  const chars = numbers.slice(1).map(num => String.fromCharCode(num));
  
  // Join prefix and characters
  return prefix + chars.join('');
}

async function main() {
  p.intro(pc.blue('🔍 Yoto Card Reader'));
  
  const s = p.spinner();
  s.start('Initializing NFC reader...');

  nfc.on('reader', async (reader) => {
    s.stop('NFC reader ready');
    currentReader = reader;

    reader.on('card', async (card) => {
      try {
        // Read the card's UID
        const uid = card.uid;
        p.note(`
Card Type: ${card.type}
Card UID: ${uid}
`, 'Card Detected');

        // Read the entire card memory
        try {
          const data = await reader.read(4, 48);
          
          // Try to find NDEF message in the raw data
          const ndefData = findNdefMessage(data);
          if (ndefData) {
            try {
              // Parse the NDEF message using the library
              const message = ndef.Message.fromBytes(ndefData);
              const records = message.getRecords();
              
              const parsedRecords = records.map(record => {
                const recordInfo = {
                  type: record.getType().toString(),
                  tnf: record.getTnf(),
                  id: record.getId()?.toString(),
                  payload: record.getPayload().toString('hex'),
                  decodedPayload: decodePayload(record.getPayload().toString())
                };
                
                // Use library utilities to parse specific record types
                if (record.getType().toString() === 'U') {
                  const uri = ndef.Utils.resolveUriRecordToString(record);
                  recordInfo.uri = uri;
                } else if (record.getType().toString() === 'T') {
                  const textInfo = ndef.Utils.resolveTextRecord(record);
                  recordInfo.text = textInfo;
                }
                
                return recordInfo;
              });
              
              if (parsedRecords.length > 0) {
                const url = parsedRecords[0].decodedPayload;
                p.note(url, 'Card Contents');
                
                // Read existing cards.json or create new if it doesn't exist
                const fs = await import('fs/promises');
                const cardsFile = 'cards.json';
                const urlsFile = 'urls.json';
                let cards = [];
                let urls = [];
                
                try {
                  const cardsData = await fs.readFile(cardsFile, 'utf8');
                  cards = JSON.parse(cardsData);
                } catch (err) {
                  // File doesn't exist or is empty, start with empty array
                }

                try {
                  const urlsData = await fs.readFile(urlsFile, 'utf8');
                  urls = JSON.parse(urlsData);
                } catch (err) {
                  // File doesn't exist or is empty, start with empty array
                }
                
                // Check if URL already exists
                const existingCard = cards.find(card => card.url === url);
                if (existingCard) {
                  p.note('URL already exists in cards.json', 'Info');
                } else {
                  // Add new card entry
                  cards.push({
                    uid,
                    timestamp: new Date().toISOString(),
                    url,
                    data: parsedRecords
                  });
                  
                  // Save updated cards.json
                  await fs.writeFile(cardsFile, JSON.stringify(cards, null, 2));
                  p.note('URL added to cards.json', 'Success');
                }

                // Check if URL exists in urls.json
                if (!urls.includes(url)) {
                  urls.push(url);
                  // Save updated urls.json
                  await fs.writeFile(urlsFile, JSON.stringify(urls, null, 2));
                  p.note('URL added to urls.json', 'Success');
                } else {
                  p.note('URL already exists in urls.json', 'Info');
                }
              } else {
                p.note('No NDEF data found on card', 'Info');
              }
            } catch (ndefErr) {
              p.log.error(`NDEF parse error: ${ndefErr.message}`);
            }
          } else {
            p.note('No NDEF TLV structure found in raw data', 'Info');
          }
        } catch (readErr) {
          p.log.error(`Error reading card: ${readErr.message}`);
        }
      } catch (err) {
        p.log.error(`Error processing card: ${err.message}`);
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

main();