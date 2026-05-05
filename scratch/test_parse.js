const fs = require('fs');
const https = require('https');

async function test() {
    const url = 'https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/cards/001257/files/60225_ruby_74180/60225_ruby_74180.txt';
    
    https.get(url, (res) => {
        let data = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('end', () => {
            const buffer = Buffer.concat(data);
            // Simulate Shift_JIS decoding (Simplified for node test)
            const iconv = require('iconv-lite');
            const text = iconv.decode(buffer, 'shift-jis');
            
            console.log('--- ORIGINAL START ---');
            console.log(text.substring(0, 1000));
            console.log('--- ORIGINAL END ---');

            // Simulate the splitting logic
            let parts = text.split(/^-{5,}/m);
            console.log(`Parts found: ${parts.length}`);
            
            for(let i=0; i<parts.length; i++) {
                console.log(`\n--- PART ${i} START (First 100 chars) ---`);
                console.log(parts[i].trim().substring(0, 100));
            }
        });
    });
}

test();
