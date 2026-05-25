require("dotenv").config();

const {
    startSyncLoop,
    catchUpPools
} = require(
    "./indexer/poolIndexer"
);


const express = require("express");
const cors = require("cors");

const connectDB =
    require("./config/db");

const relayerRoutes =
    require("./routes/relayer");
const transferRoutes = require("./routes/transferRoutes");
const stateRoutes = require("./routes/stateRoutes");

const {
    initializeRelayer
} = require("./config/provider");

const userRoutes =
    require("./routes/userRoutes");

const noidUserRoutes = require("./routes/noidUserRoutes");
const noidAccountRoutes = require("./routes/createNoidAccountRoutes");

const app = express();

app.use(
  cors({
    origin: true
  })
);

app.use(express.json());

app.get("/", (req, res) => {

    res.send(
        "Menoid Relayer backend running"
    );
});


app.use("/api/relayer", relayerRoutes);
app.use(
    "/api/users",
    userRoutes
);
app.use(
    "/api/noidusers",noidUserRoutes
);
app.use("/api/state/",stateRoutes);
app.use("/api/transfer/",transferRoutes);
app.use("/api/noidroutes/", noidAccountRoutes);

const PORT =
    process.env.PORT || 4000;

(async () => {

    await initializeRelayer();
    await connectDB();
    await catchUpPools();

    startSyncLoop(),
    app.listen(PORT, () => {

        console.log(
            `✅ ✅ ✅ Server running on port ${PORT}`
        );
    });

})();