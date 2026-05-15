import { createClient } from '@supabase/supabase-js';
import 'dotenv/config'; 

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function runBatcher() {
    console.log("🚀 Starting the Heavy Data Cruncher (Railway Edition)...");
    let totalUpdated = 0;

    while (true) {
        // This calls the custom SQL function we saved in Supabase
        const { data: rowsUpdated, error } = await supabase.rpc('batch_update_tiers');

        if (error) {
            console.error("❌ CRASH DETECTED:", error);
            break;
        }

        if (rowsUpdated === 0) {
            console.log(`\n✅ SUCCESS: All properties tiered! Total updated: ${totalUpdated}`);
            break;
        }

        totalUpdated += rowsUpdated;
        console.log(`⚙️ Processed ${rowsUpdated} records... (Total so far: ${totalUpdated})`);

        // Sleep for 1 second to let the database breathe
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

runBatcher();