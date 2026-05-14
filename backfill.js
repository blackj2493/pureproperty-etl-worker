import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import 'dotenv/config';

// 1. Initialize Supabase
// CRITICAL: Ensure this is the SERVICE_ROLE key in Railway, not the anon key
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 2. Configuration
const START_DATE = '2021-01-01';
const BATCH_SIZE = 100; // Pulling the FULL payload is heavy. Do not exceed 100 per batch.
const SLEEP_MS = 1500;  // 1.5 second pause to respect PROPTX rate limits

// --- HELPER FUNCTIONS ---

// Creates a deterministic ID so we can link active/sold records without relying on changing MLS numbers
function generatePropertyHash(address) {
    if (!address) return 'unknown';
    return address.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

// Converts ranges like "1400-1599" into a clean integer (1499.5 -> 1500) for the AI
function parseRange(rangeStr) {
    if (!rangeStr) return null;
    const parts = rangeStr.split('-').map(str => parseInt(str.replace(/[^0-9]/g, ''), 10));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return Math.round((parts[0] + parts[1]) / 2);
    }
    return null;
}

// Pauses the script
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- MAIN EXECUTION ---

async function runBackfill() {
    console.log("🚀 Starting PureProperty VOW Backfill (Full Payload Mode)...");
    
    // IF THE SCRIPT CRASHES: Change this number to the last successful skip count
    let skipCount = 0; 
    let hasMoreData = true;

    while (hasMoreData) {
        try {
            console.log(`Fetching records ${skipCount} to ${skipCount + BATCH_SIZE}...`);
            
         
// 3. The API Call (Manually building URL to prevent Axios from using '+' for spaces)
            const queryParams = `?$filter=MlsStatus eq 'Sold' and CloseDate ge ${START_DATE}&$top=${BATCH_SIZE}&$skip=${skipCount}&$orderby=CloseDate asc`;
            const encodedUrl = `${process.env.PROPTX_API_URL}/Property${queryParams.replace(/ /g, '%20')}`;

            const response = await axios.get(encodedUrl, {
                headers: { 'Authorization': `Bearer ${process.env.PROPTX_BEARER_TOKEN}` }
            });
            // 4. Data Transformation Pipeline
            const supabasePayload = listings.map(listing => {
                
                // A. Flatten the text arrays so we can search for premium keywords
                const basementStr = Array.isArray(listing.Basement) ? listing.Basement.join(' ').toLowerCase() : (listing.Basement || '').toLowerCase();
                const interiorStr = Array.isArray(listing.InteriorFeatures) ? listing.InteriorFeatures.join(' ').toLowerCase() : (listing.InteriorFeatures || '').toLowerCase();
                const exteriorStr = Array.isArray(listing.ExteriorFeatures) ? listing.ExteriorFeatures.join(' ').toLowerCase() : (listing.ExteriorFeatures || '').toLowerCase();

                // B. Construct the clean row for Supabase
                return {
                    // Identifiers
                    listing_key: listing.ListingKey,
                    unparsed_address: listing.UnparsedAddress,
                    property_hash: generatePropertyHash(listing.UnparsedAddress),
                    
                    // Core Location & Shell
                    city_region: listing.CityRegion,
                    city: listing.City,
                    postal_code: listing.PostalCode ? listing.PostalCode.substring(0, 3) : null, // FSA Extraction
                    property_sub_type: listing.PropertySubType,
                    architectural_style: Array.isArray(listing.ArchitecturalStyle) ? listing.ArchitecturalStyle[0] : listing.ArchitecturalStyle,
                    
                    // Cleaned Numbers
                    approximate_age: listing.ApproximateAge, // You can parse this later if needed, kept raw for now
                    living_area_range: parseRange(listing.LivingAreaRange),
                    building_area_total: listing.BuildingAreaTotal || parseRange(listing.LivingAreaRange), // Fallback if missing
                    lot_width: listing.LotWidth,
                    lot_depth: listing.LotDepth,
                    
                    // Structural Details (Strictly separated above/below grade)
                    bedrooms_above_grade: listing.BedroomsAboveGrade,
                    bedrooms_below_grade: listing.BedroomsBelowGrade,
                    bathrooms_total_integer: listing.BathroomsTotalInteger,
                    rooms_above_grade: listing.RoomsAboveGrade,
                    rooms_below_grade: listing.RoomsBelowGrade,
                    kitchens_above_grade: listing.KitchensAboveGrade,
                    kitchens_below_grade: listing.KitchensBelowGrade,
                    parking_total: listing.ParkingTotal,
                    covered_spaces: listing.CoveredSpaces,
                    
                    // Financial Drag
                    tax_annual_amount: listing.TaxAnnualAmount,
                    association_fee: listing.AssociationFee || 0, // Default to 0 for freehold
                    
                    // Pricing & Timelines
                    list_price: listing.ListPrice, // Saved for UI/Analytics, but DO NOT export this column to AI
                    close_price: listing.ClosePrice,
                    purchase_contract_date: listing.PurchaseContractDate,
                    close_date: listing.CloseDate,
                    
                    // The Boolean "Alpha" Features
                    has_finished_basement: basementStr.includes('finished'),
                    has_premium_interior: interiorStr.includes('quartz') || interiorStr.includes('hardwood') || interiorStr.includes('built-in') || interiorStr.includes('custom'),
                    has_premium_exterior: exteriorStr.includes('pool') || exteriorStr.includes('ravine'),
                    
                    // The Vault (The massive raw JSON payload for the UI)
                    raw_payload: listing
                };
            });

            // 5. Upsert to Supabase
            const { error } = await supabase
                .from('raw_vow_sold')
                .upsert(supabasePayload, { onConflict: 'listing_key' });

            if (error) {
                throw new Error(`Supabase Upsert Failed: ${error.message}`);
            }

            console.log(`💾 Saved batch of ${listings.length} properties. Sleeping to prevent rate-limit...`);
            
            // 6. Pagination Increment
            skipCount += BATCH_SIZE;
            await sleep(SLEEP_MS);

        } catch (error) {
            console.error("❌ CRASH DETECTED:");
            if (error.response) {
                console.error("PROPTX API Error:", error.response.status, error.response.data);
            } else {
                console.error("System Error:", error.message);
            }
            console.log(`\n⚠️ RESUME INSTRUCTIONS: Open backfill.js and change 'let skipCount = 0;' to 'let skipCount = ${skipCount};' then push to Railway to resume from this checkpoint.\n`);
            hasMoreData = false; 
        }
    }
}

runBackfill();