import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import 'dotenv/config';

// 1. Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 2. Configuration
const START_DATE = '2021-01-01'; // Clean, string-based Edm.Date
const BATCH_SIZE = 100;
const SLEEP_MS = 1500; 

function generatePropertyHash(address) {
    if (!address) return 'unknown';
    return address.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function parseRange(rangeStr) {
    if (!rangeStr) return null;
    const parts = rangeStr.split('-').map(str => parseInt(str.replace(/[^0-9]/g, ''), 10));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return Math.round((parts[0] + parts[1]) / 2);
    }
    return null;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runBackfill() {
    console.log("🚀 Starting PureProperty VOW Backfill (Diagnostic Mode)...");
    
    let skipCount = 0; 
    let hasMoreData = true;

    while (hasMoreData) {
        try {
            console.log(`\n⏳ Fetching records ${skipCount} to ${skipCount + BATCH_SIZE}...`);
            
            // 3. The API Call (Strict OData Encoding)
            const baseUrl = process.env.PROPTX_API_URL.replace(/\/$/, ''); // Removes trailing slash if you accidentally added one
            const rawQuery = `?$filter=MlsStatus eq 'Sold' and CloseDate ge ${START_DATE}&$top=${BATCH_SIZE}&$skip=${skipCount}&$orderby=CloseDate asc`;
            const encodedUrl = `${baseUrl}/Property${rawQuery.replace(/ /g, '%20')}`;

            console.log(`🌐 Hitting URL: ${encodedUrl}`);

            const response = await axios.get(encodedUrl, {
                headers: { 'Authorization': `Bearer ${process.env.PROPTX_BEARER_TOKEN}` }
            });

            const listings = response.data.value;

            if (!listings || listings.length === 0) {
                console.log("✅ Backfill Complete. No more records found.");
                hasMoreData = false;
                break;
            }

            console.log(`✅ Successfully downloaded ${listings.length} properties. Transforming data...`);

            // 4. Data Transformation
            const supabasePayload = listings.map(listing => {
                const basementStr = Array.isArray(listing.Basement) ? listing.Basement.join(' ').toLowerCase() : (listing.Basement || '').toLowerCase();
                const interiorStr = Array.isArray(listing.InteriorFeatures) ? listing.InteriorFeatures.join(' ').toLowerCase() : (listing.InteriorFeatures || '').toLowerCase();
                const exteriorStr = Array.isArray(listing.ExteriorFeatures) ? listing.ExteriorFeatures.join(' ').toLowerCase() : (listing.ExteriorFeatures || '').toLowerCase();

                return {
                    listing_key: String(listing.ListingKey),
                    unparsed_address: listing.UnparsedAddress,
                    property_hash: generatePropertyHash(listing.UnparsedAddress),
                    city_region: listing.CityRegion,
                    city: listing.City,
                    postal_code: listing.PostalCode ? listing.PostalCode.substring(0, 3) : null,
                    property_sub_type: listing.PropertySubType,
                    architectural_style: Array.isArray(listing.ArchitecturalStyle) ? listing.ArchitecturalStyle[0] : listing.ArchitecturalStyle,
                    approximate_age: listing.ApproximateAge,
                    living_area_range: parseRange(listing.LivingAreaRange),
                    building_area_total: listing.BuildingAreaTotal || parseRange(listing.LivingAreaRange),
                    lot_width: listing.LotWidth,
                    lot_depth: listing.LotDepth,
                    bedrooms_above_grade: listing.BedroomsAboveGrade,
                    bedrooms_below_grade: listing.BedroomsBelowGrade,
                    bathrooms_total_integer: listing.BathroomsTotalInteger,
                    rooms_above_grade: listing.RoomsAboveGrade,
                    rooms_below_grade: listing.RoomsBelowGrade,
                    kitchens_above_grade: listing.KitchensAboveGrade,
                    kitchens_below_grade: listing.KitchensBelowGrade,
                    parking_total: listing.ParkingTotal,
                    covered_spaces: listing.CoveredSpaces,
                    tax_annual_amount: listing.TaxAnnualAmount,
                    association_fee: listing.AssociationFee || 0,
                    list_price: listing.ListPrice,
                    close_price: listing.ClosePrice,
                    purchase_contract_date: listing.PurchaseContractDate,
                    close_date: listing.CloseDate,
                    has_finished_basement: basementStr.includes('finished'),
                    has_premium_interior: interiorStr.includes('quartz') || interiorStr.includes('hardwood') || interiorStr.includes('built-in') || interiorStr.includes('custom'),
                    has_premium_exterior: exteriorStr.includes('pool') || exteriorStr.includes('ravine'),
                    raw_payload: listing
                };
            });

            console.log(`💾 Pushing ${supabasePayload.length} records to Supabase Vault...`);

            // 5. Upsert to Supabase
            const { error } = await supabase
                .from('raw_vow_sold')
                .upsert(supabasePayload, { onConflict: 'listing_key' });

            if (error) {
                throw new Error(`Supabase DB Error: ${JSON.stringify(error)}`);
            }

            console.log(`🟢 Batch Saved! Sleeping for 1.5s...`);
            
            skipCount += BATCH_SIZE;
            await sleep(SLEEP_MS);

        } catch (error) {
            // FORCING ALL ERRORS TO STANDARD LOG SO RAILWAY CANNOT HIDE THEM
            console.log("\n=========================================");
            console.log("❌ FATAL CRASH DETECTED");
            console.log("=========================================");
            
            if (error.response) {
                console.log(`🛑 PROPTX API REJECTED THE REQUEST:`);
                console.log(`Status Code: ${error.response.status}`);
                console.log(`Response Body: ${JSON.stringify(error.response.data, null, 2)}`);
            } else {
                console.log(`🛑 NODE.JS / SYSTEM ERROR:`);
                console.log(error.message);
                console.log(`\nSTACK TRACE:\n${error.stack}`);
            }
            console.log("=========================================\n");
            
            console.log(`⚠️ RESUME INSTRUCTIONS: Open backfill.js and change 'let skipCount = 0;' to 'let skipCount = ${skipCount};'\n`);
            hasMoreData = false; 
        }
    }
}

runBackfill();