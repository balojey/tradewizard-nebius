#!/usr/bin/env node

/**
 * Favicon Generation Script for TradeWizard
 * 
 * This script helps generate the missing favicon files from the existing SVG.
 * Run this script after installing sharp: npm install --save-dev sharp
 */

const fs = require('fs');
const path = require('path');

console.log('TradeWizard Favicon Generation Helper');
console.log('=====================================');
console.log('');
console.log('To generate the missing favicon files, you need to:');
console.log('');
console.log('1. Install sharp: npm install --save-dev sharp');
console.log('2. Run the following commands:');
console.log('');
console.log('   # Generate 16x16 PNG');
console.log('   node -e "const sharp = require(\'sharp\'); sharp(\'public/favicon.svg\').resize(16, 16).png().toFile(\'public/favicon-16x16.png\');"');
console.log('');
console.log('   # Generate 192x192 PNG for PWA');
console.log('   node -e "const sharp = require(\'sharp\'); sharp(\'public/favicon.svg\').resize(192, 192).png().toFile(\'public/favicon-192x192.png\');"');
console.log('');
console.log('   # Generate 512x512 PNG for PWA');
console.log('   node -e "const sharp = require(\'sharp\'); sharp(\'public/favicon.svg\').resize(512, 512).png().toFile(\'public/favicon-512x512.png\');"');
console.log('');
console.log('   # Generate Apple Touch Icon');
console.log('   node -e "const sharp = require(\'sharp\'); sharp(\'public/favicon.svg\').resize(180, 180).png().toFile(\'public/apple-touch-icon.png\');"');
console.log('');
console.log('   # Generate ICO file (requires ico-convert)');
console.log('   # npm install --save-dev ico-convert');
console.log('   # node -e "const icoConvert = require(\'ico-convert\'); const fs = require(\'fs\'); const sharp = require(\'sharp\'); sharp(\'public/favicon.svg\').resize(32, 32).png().toBuffer().then(buf => fs.writeFileSync(\'public/favicon.ico\', icoConvert(buf)));"');
console.log('');
console.log('Alternatively, you can use online tools like:');
console.log('- https://realfavicongenerator.net/');
console.log('- https://favicon.io/favicon-converter/');
console.log('');
console.log('Upload the public/favicon.svg file to generate all required formats.');