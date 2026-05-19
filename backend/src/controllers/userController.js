const User =
    require("../models/User");


// create user
async function createUser(
    req,
    res
) {

    try {

        const {

            name,

            realAddress

        } = req.body;

        const existingUser =
            await User.findOne({
                realAddress
            });

        if (existingUser) {

            return res.status(400).json({

                error:
                    "User already exists"
            });
        }

        const user =
            await User.create({

                name,

                realAddress
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
async function getAllUsers(
    req,
    res
) {

    try {

        const users =
            await User.find();

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

    createUser,

    getAllUsers
};