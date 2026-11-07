FEMA's answers, in the shape of its ArcGIS REST query and service directory replies (fields FLD_ZONE, ZONE_SUBTY, SFHA_TF).
FEMA's servers reset connections from the machine these were written on, so they follow FEMA's documented reply format
rather than being captured from it. Re-record them from the production server (see DEPLOY.md) when it can reach FEMA.
The NHC files in ../nhc were downloaded from nhc.noaa.gov on 2026-11-07.
TEST_ATLANTIC_STORM.json and TEST_SOUTH_FLORIDA_CONE.kmz are made for the tests from those files' structure: a made-up
hurricane whose cone covers Miami-Dade and Broward.
