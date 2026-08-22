import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function main() {
  const db = getPrismaClient();
  try {
    const totalBusinesses = await db.business.count();
    const withEmail = await db.contact.count({ where: { type: 'EMAIL' } });
    const withPhone = await db.contact.count({ where: { type: 'PHONE' } });
    const withForm = await db.contact.count({ where: { type: 'CONTACT_FORM' } });

    console.log(`\n======================================================`);
    console.log(`DATABASE TOTAL SUMMARY:`);
    console.log(`• Total Businesses in SQLite: ${totalBusinesses}`);
    console.log(`• Total Email Contacts      : ${withEmail}`);
    console.log(`• Total Phone Contacts      : ${withPhone}`);
    console.log(`• Total Contact Form URL Contacts: ${withForm}`);
    console.log(`======================================================\n`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch(console.error);
