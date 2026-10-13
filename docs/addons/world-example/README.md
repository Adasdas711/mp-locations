# Shared World Demo

Open `shared-world-demo.mpalace`, install this directory as a PALACE addon ZIP, then use the Command palette commands starting with **Demo:**. The archive contains three synthetically rendered, explicitly calibrated 360° room photos and one global sphere. Camera A/B/C share a meter-scale frame; changing camera shows the same entity from another viewpoint.

**Demo: create/reset one shared sphere** registers the known fixture poses and creates or resets the single `demo-locus` entity. It refuses projects whose name is not Shared World Demo. These example transforms are not a calibration algorithm for real photographs.

Camera commands select and wait for rendering, convert the world point into the chosen panorama's local coordinates, then animate the existing SDK camera towards it. The UI's World objects control can select/move/delete the same sphere. Save the project to keep changes. Full contract: `WORLD_SDK.md`.
