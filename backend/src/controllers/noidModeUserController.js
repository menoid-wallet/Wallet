const NoidUser =
    require("../models/NoidUser");

// create user
async function createNoidUser(
    req,
    res
) {

    try {

        const {
            name,
            noidModePublicKey,
            zkPublicKey
        } = req.body;

        const existingUser =
            await NoidUser.findOne({
                realAddress
            });

        if (existingUser) {

            return res.status(400).json({

                error:
                    "User already exists"
            });
        }

        const user =
            await NoidUser.create({

                name,

                noidModePublicKey,

                zkPublicKey
            });

        return res.status(201).json(user);

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            error:
                "Failed to create user"
        });
    }
}


// get all users
async function getAllNoidUsers(
    req,
    res
) {

    try {

        const users =
            await NoidUser.find();

        return res.json(users);

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            error:
                "Failed to fetch users"
        });
    }
}

module.exports = {

    createNoidUser,

    getAllNoidUsers
};