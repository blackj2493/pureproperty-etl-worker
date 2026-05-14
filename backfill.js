import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import 'dotenv/config';

// 1. Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 2. Configuration & The "Safe Overlap" Starting Line
let currentDateMarker = '2025-04-28'; 
let skipCount = 0; 

const BATCH_SIZE = 100;
const SLEEP_MS = 1500; 

// --- HELPER FUNCTIONS ---

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

// --- MAIN EXECUTION ---

async function runBackfill() {
    console.log("🚀 Starting PureProperty VOW Backfill (Finishing the Vault)...");
    
    let hasMoreData = true;

    while (hasMoreData) {
        try {
            console.log(`\n⏳ Fetching records ${skipCount} to ${skipCount + BATCH_SIZE} (Since ${currentDateMarker})...`);
            
            // 3. Strict OData API Call
            const baseUrl = process.env.PROPTX_API_URL.replace(/\/$/, ''); 
            const rawQuery = `?$filter=MlsStatus eq 'Sold' and CloseDate ge ${currentDateMarker}&$top=${BATCH_SIZE}&$skip=${skipCount}&$orderby=CloseDate asc`;
            const encodedUrl = `${baseUrl}/Property${rawQuery.replace(/ /g, '%20')}`;

            const response = await axios.get(encodedUrl, {
                headers: { 'Authorization': `Bearer ${process.env.PROPTX_BEARER_TOKEN}` }
            });

            const listings = response.data.value;

            if (!listings || listings.length === 0) {
                console.log("✅ Backfill Complete. Your vault is now 100% up to date.");
                hasMoreData = false;
                break;
            }

            // 4. Data Transformation (Includes your granular basement logic!)
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
                    
                    // The Granular Basement Updates
                    is_finished_basement: basementStr.includes('finished') && !basementStr.includes('partially'),
                    has_separate_entrance: basementStr.includes('sep entrance') || basementStr.includes('separate'),
                    is_walk_out: basementStr.includes('w/o') || basementStr.includes('walk-out') || basementStr.includes('walk out'),
                    
                    has_premium_interior: interiorStr.includes('quartz') || interiorStr.includes('hardwood') || interiorStr.includes('built-in') || interiorStr.includes('custom'),
                    has_premium_exterior: exteriorStr.includes('pool') || exteriorStr.includes('ravine'),
                    raw_payload: listing
                };
            });

            // 5. Push to Supabase
            const { error } = await supabase
                .from('raw_vow_sold')
                .upsert(supabasePayload, { onConflict: 'listing_key' });

            if (error) {
                throw new Error(`Supabase DB Error: ${JSON.stringify(error)}`);
            }
            
            skipCount += BATCH_SIZE;

            // 6. The Auto-Shifter (Prevents the 100k limit crash)
            if (skipCount >= 90000) {
                const lastHouse = listings[listings.length - 1];
                currentDateMarker = String(lastHouse.CloseDate).substring(0, 10); 
                console.log(`\n🔄 Safety Limit Reached. Shifting starting line to ${currentDateMarker} and resetting skipCount to 0...`);
                skipCount = 0; 
            }

            await sleep(SLEEP_MS);

        } catch (error) {
            console.log("\n=========================================");
            console.log("❌ FATAL CRASH DETECTED");
            console.log("=========================================");
            if (error.response) {
                console.log(`Status Code: ${error.response.status}`);
                console.log(`Response Body: ${JSON.stringify(error.response.data, null, 2)}`);
            } else {
                console.log(error.message);
            }
            console.log("=========================================\n");
            hasMoreData = false; 
        }
    }
}

runBackfill();