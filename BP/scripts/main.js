import "./DoriosCore/index.js";
import * as DoriosLib from "./DoriosLib/index.js";
import "./config/main.js";
import "./machinery/main.js";

DoriosLib.registry.install();
DoriosLib.container.initialize();
DoriosLib.linkNode.initializeLinkNodeIO();
