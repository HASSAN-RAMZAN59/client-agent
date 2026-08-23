const text = 'Dentist in Dallas, TX AmeriSmiles Dental';
const regex = /^(?:dentist|dentistry|dental|hvac|doctor|plumber|lawyer|attorney|roofing|electrician|cleaning|chiropractor|orthodontist|pediatric\s+dentist)\s+(?:in\s+[^]+?|near\s+me|services\s+in\s+[^]+?)\s+(?=[A-Z][a-z0-9])/i;
console.log('Regex test:', regex.test(text));
console.log('Replaced:', text.replace(regex, ''));
