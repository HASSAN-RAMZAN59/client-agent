import { cleanSearchTitleToBusinessName } from '../src/modules/discovery/normalizer.js';

console.log('1:', cleanSearchTitleToBusinessName('Dentist in Dallas, TX AmeriSmiles Dental', { city: 'Dallas', state: 'TX' }));
console.log('2:', cleanSearchTitleToBusinessName('Dentist near me Dental House', { city: 'Dallas', state: 'TX' }));
console.log('3:', cleanSearchTitleToBusinessName('Dallas, TX Dentists', { city: 'Dallas', state: 'TX' }));
