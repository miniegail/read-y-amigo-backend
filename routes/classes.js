const express = require("express");
const mongoose = require("mongoose");

const upload = require("../middleware/upload");

const Class = require("../models/Class");
const StreamPost = require("../models/StreamPost");
const Classwork = require("../models/ClassWork");
const Enrollment = require("../models/Enrollment");
const Material = require("../models/Materials");
const { saveBuffer } = require("../utils/gridfs");

const { requireAuth, requireRole } = require("../middleware/auth");

// ── Teacher router ────────────────────────────────────────────────────────────

const router = express.Router();

router.use(requireAuth, requireRole("teacher"));

// Avoids visually ambiguous characters.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateClassCode() {
  let code = "";

  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }

  return code;
}

async function generateUniqueClassCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateClassCode();
    const taken = await Class.exists({ code });

    if (!taken) return code;
  }

  throw new Error("Couldn't generate a unique class code. Please try again.");
}

// Check class ownership
router.param("classId", async (req, res, next, classId) => {
  try {
    const classDoc = await Class.findOne({
      _id: classId,
      status: "active",
    });

    if (!classDoc) {
      return res.status(404).json({
        error: "Class not found.",
      });
    }

    if (classDoc.teacher.toString() !== req.userId) {
      return res.status(403).json({
        error: "You don't have access to this class.",
      });
    }

    req.classDoc = classDoc;
    next();
  } catch (err) {
    console.error(err);

    res.status(400).json({
      error: "Invalid class id.",
    });
  }
});

// ---------- Classes ----------

// GET /api/classes/mine
router.get("/mine", async (req, res) => {
  try {
    const classes = await Class.aggregate([
      {
        $match: {
          teacher: new mongoose.Types.ObjectId(req.userId),
          status: "active",
        },
      },
      {
        $lookup: {
          from: "enrollments",
          localField: "_id",
          foreignField: "class",
          as: "enrollments",
        },
      },
      {
        $addFields: {
          learnerCount: {
            $size: "$enrollments",
          },
        },
      },
      {
        $project: {
          enrollments: 0,
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
    ]);

    res.json({ classes });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
});

// GET /api/classes/archived
router.get("/archived", async (req, res) => {
  try {
    const classes = await Class.aggregate([
      {
        $match: {
          teacher: new mongoose.Types.ObjectId(req.userId),
          status: "deleted",
        },
      },
      {
        $lookup: {
          from: "enrollments",
          localField: "_id",
          foreignField: "class",
          as: "enrollments",
        },
      },
      {
        $addFields: {
          learnerCount: {
            $size: "$enrollments",
          },
        },
      },
      {
        $project: {
          enrollments: 0,
        },
      },
      {
        $sort: {
          updatedAt: -1,
        },
      },
    ]);

    res.json({ classes });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
});

// POST /api/classes
router.post("/", async (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        error: "A class title is required.",
      });
    }

    const code = await generateUniqueClassCode();

    const newClass = await Class.create({
      teacher: req.userId,
      title: title.trim(),
      description: description || "",
      code,
    });

    res.status(201).json({
      class: newClass,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
});

// GET /api/classes/:classId
router.get("/:classId", async (req, res) => {
  try {
    const learnerCount = await Enrollment.countDocuments({
      class: req.classDoc._id,
    });

    res.json({
      class: req.classDoc,
      learnerCount,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
});

// PATCH /api/classes/:classId
router.patch("/:classId", async (req, res) => {
  try {
    const { title, description } = req.body;

    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) {
        return res.status(400).json({
          error: "A class title is required.",
        });
      }

      req.classDoc.title = title.trim();
    }

    if (description !== undefined) {
      req.classDoc.description = description;
    }

    await req.classDoc.save();

    res.json({
      class: req.classDoc,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
});

// DELETE /api/classes/:classId
router.delete("/:classId", async (req, res) => {
  try {
    req.classDoc.status = "deleted";

    await req.classDoc.save();

    res.json({
      class: req.classDoc,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
});

// PATCH /api/classes/:archivedClassId/restore
router.patch("/:archivedClassId/restore", async (req, res) => {
  try {
    const classDoc = await Class.findOne({
      _id: req.params.archivedClassId,
      teacher: req.userId,
      status: "deleted",
    });

    if (!classDoc) {
      return res.status(404).json({
        error: "Archived class not found.",
      });
    }

    classDoc.status = "active";

    await classDoc.save();

    res.json({
      class: classDoc,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
});

// GET /api/classes/:classId/stream
router.get("/:classId/stream", async (req, res) => {
  try {
    const posts = await StreamPost.find({
  class: req.params.classId,
})
  .populate(
    "author",
    "displayName firstName secondName role"
  )
  .sort({
    createdAt: -1,
  });

    res.json({ posts });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
});

// POST /api/classes/:classId/stream
router.post("/:classId/stream", async (req, res) => {
  try {
    const { title, body } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        error: "A title is required.",
      });
    }

    const post = await StreamPost.create({
      class: req.classDoc._id,
      author: req.userId,
      title: title.trim(),
      body: body || "",
    });

    res.status(201).json({
      post,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
});

// POST /api/classes/:classId/stream/:postId/save-material
// Saves a Stream post as a Material Library item.
router.post(
  "/:classId/stream/:postId/save-material",
  async (req, res) => {
    try {
      const post = await StreamPost.findOne({
        _id: req.params.postId,
        class: req.classDoc._id,
      });

      if (!post) {
        return res.status(404).json({
          error: "Stream post not found.",
        });
      }

      // Prevent duplicate materials from the same Stream post.
      if (post.materialId) {
        const existingMaterial = await Material.findById(
          post.materialId
        );

        if (existingMaterial) {
          const populatedMaterial =
            await existingMaterial.populate(
              "uploadedBy",
              "displayName firstName secondName"
            );

          return res.json({
            material: populatedMaterial,
          });
        }

        // If the linked material was deleted, clear the old reference.
        post.materialId = null;
      }

      const material = await Material.create({
        class: req.classDoc._id,
        uploadedBy: req.userId,
        title: post.title,
        description: post.body || "",
        type: "other",
        fileUrl: "",
        category: "General",
      });

      post.materialId = material._id;

      await post.save();

      const populatedMaterial = await material.populate(
        "uploadedBy",
        "displayName firstName secondName"
      );

      res.status(201).json({
        material: populatedMaterial,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: "Failed to save post as material.",
      });
    }
  }
);

// ---------- Classwork ----------

// GET /api/classes/:classId/classwork
router.get("/:classId/classwork", async (req, res) => {
  try {
    const items = await Classwork.find({
      class: req.classDoc._id,
    })
      .populate("material")
      .sort({
        dueDate: 1,
        createdAt: -1,
      });

    res.json({
      classwork: items,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong while loading classwork.",
    });
  }
});

// POST /api/classes/:classId/classwork
router.post(
  "/:classId/classwork",
  upload.single("file"),
  async (req, res) => {
    try {
      const {
        title,
        description,
        type,
        dueDate,
        points,
        material,
        readingActivities,
        quizType,
        questions,
        assignToAll,
        assignedTo,
      } = req.body;

      // -------------------------
      // Validate title
      // -------------------------

      if (!title || !title.trim()) {
        return res.status(400).json({
          error: "A title is required.",
        });
      }

      // -------------------------
      // Validate classwork type
      // -------------------------

      const allowedTypes = [
        "reading",
        "activity",
        "quiz",
      ];

      if (!allowedTypes.includes(type)) {
        return res.status(400).json({
          error:
            "Classwork type must be reading, activity, or quiz.",
        });
      }

      // -------------------------
      // Parse assignToAll
      // -------------------------

      const shouldAssignToAll =
        assignToAll === true ||
        assignToAll === "true";

      // -------------------------
      // Parse selected learners
      // -------------------------

      let selectedLearners = [];

      if (assignedTo) {
        try {
          selectedLearners =
            typeof assignedTo === "string"
              ? JSON.parse(assignedTo)
              : assignedTo;
        } catch (err) {
          return res.status(400).json({
            error: "Invalid assigned learners format.",
          });
        }
      }

      if (!Array.isArray(selectedLearners)) {
        selectedLearners = [];
      }

      // -------------------------
      // Validate selected learners
      // -------------------------

      if (!shouldAssignToAll) {
        if (selectedLearners.length === 0) {
          return res.status(400).json({
            error:
              "Select at least one learner or choose Assign to all learners.",
          });
        }

        const enrollments =
          await Enrollment.find({
            class: req.classDoc._id,
            learner: {
              $in: selectedLearners,
            },
          });

        if (
          enrollments.length !==
          selectedLearners.length
        ) {
          return res.status(400).json({
            error:
              "One or more selected learners are not enrolled in this class.",
          });
        }
      }

      // -------------------------
      // Validate material
      // -------------------------

      let selectedMaterial = null;

      if (material) {
        selectedMaterial = await Material.findOne({
          _id: material,
          class: req.classDoc._id,
        });

        if (!selectedMaterial) {
          return res.status(400).json({
            error:
              "The selected material does not belong to this class.",
          });
        }
      }

      // -------------------------
      // Parse reading activities
      // -------------------------

      let parsedReadingActivities = [];

      if (readingActivities) {
        try {
          parsedReadingActivities =
            typeof readingActivities === "string"
              ? JSON.parse(readingActivities)
              : readingActivities;
        } catch (err) {
          return res.status(400).json({
            error:
              "Invalid reading activities format.",
          });
        }
      }

      if (!Array.isArray(parsedReadingActivities)) {
        parsedReadingActivities = [];
      }

      const allowedReadingActivities = [
        "read-aloud",
        "comprehension",
      ];

      parsedReadingActivities =
        parsedReadingActivities.filter((activity) =>
          allowedReadingActivities.includes(activity)
        );

      // -------------------------
      // Parse quiz questions
      // -------------------------

      let parsedQuestions = [];

      if (questions) {
        try {
          parsedQuestions =
            typeof questions === "string"
              ? JSON.parse(questions)
              : questions;
        } catch (err) {
          return res.status(400).json({
            error: "Invalid quiz questions format.",
          });
        }
      }

      if (!Array.isArray(parsedQuestions)) {
        parsedQuestions = [];
      }

      // -------------------------
      // Validate quiz
      // -------------------------

      const allowedQuizTypes = [
        "multiple-choice",
        "checkboxes",
        "true-false",
        "short-answer",
        "essay",
        "mixed",
      ];

      if (type === "quiz") {
        if (!quizType || !allowedQuizTypes.includes(quizType)) {
          return res.status(400).json({
            error: "A valid quiz type is required.",
          });
        }

        if (parsedQuestions.length === 0) {
          return res.status(400).json({
            error:
              "A quiz must contain at least one question.",
          });
        }

        const allowedQuestionTypes = [
          "multiple-choice",
          "checkboxes",
          "true-false",
          "short-answer",
          "essay",
        ];

        for (const question of parsedQuestions) {
          if (
            !question.type ||
            !allowedQuestionTypes.includes(
              question.type
            )
          ) {
            return res.status(400).json({
              error:
                "Every quiz question must have a valid question type.",
            });
          }

          if (
            !question.question ||
            !String(question.question).trim()
          ) {
            return res.status(400).json({
              error:
                "Every quiz question must contain question text.",
            });
          }

          if (
            question.type === "multiple-choice" ||
            question.type === "checkboxes"
          ) {
            if (
              !Array.isArray(question.choices) ||
              question.choices.length < 2
            ) {
              return res.status(400).json({
                error:
                  "Multiple choice and checkbox questions need at least two choices.",
              });
            }
          }
        }
      }

      // -------------------------
      // Validate due date
      // -------------------------

      let parsedDueDate;

      if (dueDate) {
        parsedDueDate = new Date(dueDate);

        if (Number.isNaN(parsedDueDate.getTime())) {
          return res.status(400).json({
            error: "Invalid due date.",
          });
        }
      }

      // -------------------------
      // Validate points
      // -------------------------

      let parsedPoints = 0;

      if (points !== undefined && points !== "") {
        parsedPoints = Number(points);

        if (
          Number.isNaN(parsedPoints) ||
          parsedPoints < 0
        ) {
          return res.status(400).json({
            error:
              "Points must be a number greater than or equal to 0.",
          });
        }
      }

           // -------------------------
      // Uploaded attachment (stored in MongoDB via GridFS)
      // -------------------------

      let attachment = undefined;

      if (req.file) {
        const fileId = await saveBuffer({
          buffer: req.file.buffer,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          metadata: {
            class: req.classDoc._id,
            uploadedBy: req.userId,
            kind: "attachment",
          },
        });

        attachment = {
          name: req.file.originalname,
          url: `/api/files/${fileId}`,
          fileId,
          mimeType: req.file.mimetype,
          size: req.file.size,
        };
      }
      
      // -------------------------
      // Create Classwork
      // -------------------------

      const item = await Classwork.create({
        class: req.classDoc._id,

        title: title.trim(),

        description:
          typeof description === "string"
            ? description.trim()
            : "",

        type,

        dueDate: parsedDueDate,

        points: parsedPoints,

        attachment,

        material: selectedMaterial
          ? selectedMaterial._id
          : null,

        readingActivities:
          type === "reading"
            ? parsedReadingActivities
            : [],

        quizType:
          type === "quiz"
            ? quizType
            : undefined,

        questions:
          type === "quiz"
            ? parsedQuestions
            : [],

        assignToAll: shouldAssignToAll,

        assignedTo: shouldAssignToAll
          ? []
          : selectedLearners,
      });

      // -------------------------
      // Create Stream post
      // -------------------------

      const typeLabels = {
        reading: "Reading Assignment",
        activity: "Activity",
        quiz: "Quiz",
      };

      let streamBody =
        `${typeLabels[type]} posted.`;

      if (item.description) {
        streamBody += `\n\n${item.description}`;
      }

      if (item.dueDate) {
        streamBody += `\n\nDue: ${item.dueDate.toISOString()}`;
      }

      if (item.points > 0) {
        streamBody += `\nPoints: ${item.points}`;
      }

      const streamPost =
        await StreamPost.create({
          class: req.classDoc._id,
          author: req.userId,
          title: item.title,
          body: streamBody,
        });

      // -------------------------
      // Populate material
      // -------------------------

      await item.populate("material");

      res.status(201).json({
        classwork: item,
        streamPost,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          "Something went wrong while creating classwork.",
      });
    }
  }
);

// ---------- Materials Library ----------

// GET /api/classes/:classId/materials
router.get("/:classId/materials", async (req, res) => {
  try {
    const materials = await Material.find({
      class: req.classDoc._id,
    })
      .populate(
        "uploadedBy",
        "displayName firstName secondName"
      )
      .sort({
        createdAt: -1,
      });

    res.json({
      materials,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong while loading materials.",
    });
  }
});

// POST /api/classes/:classId/materials
router.post("/:classId/materials", async (req, res) => {
  try {
    const {
      title,
      description,
      type,
      fileUrl,
      category,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        error: "A material title is required.",
      });
    }

    const material = await Material.create({
      class: req.classDoc._id,
      uploadedBy: req.userId,
      title: title.trim(),
      description: description || "",
      type: type || "document",
      fileUrl: fileUrl || "",
      category: category || "General",
    });

    const populatedMaterial = await material.populate(
      "uploadedBy",
      "displayName firstName secondName"
    );

    res.status(201).json({
      material: populatedMaterial,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error:
        "Something went wrong while creating the material.",
    });
  }
});

// PATCH /api/classes/:classId/materials/:materialId
router.patch(
  "/:classId/materials/:materialId",
  async (req, res) => {
    try {
      const {
        title,
        description,
        type,
        fileUrl,
        category,
      } = req.body;

      const material = await Material.findOne({
        _id: req.params.materialId,
        class: req.classDoc._id,
      });

      if (!material) {
        return res.status(404).json({
          error: "Material not found.",
        });
      }

      if (title !== undefined) {
        if (
          typeof title !== "string" ||
          !title.trim()
        ) {
          return res.status(400).json({
            error: "A material title is required.",
          });
        }

        material.title = title.trim();
      }

      if (description !== undefined) {
        material.description = description;
      }

      if (type !== undefined) {
        material.type = type;
      }

      if (fileUrl !== undefined) {
        material.fileUrl = fileUrl;
      }

      if (category !== undefined) {
        material.category = category;
      }

      await material.save();

      const populatedMaterial =
        await material.populate(
          "uploadedBy",
          "displayName firstName secondName"
        );

      res.json({
        material: populatedMaterial,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          "Something went wrong while updating the material.",
      });
    }
  }
);

// DELETE /api/classes/:classId/materials/:materialId
router.delete(
  "/:classId/materials/:materialId",
  async (req, res) => {
    try {
      const material =
        await Material.findOneAndDelete({
          _id: req.params.materialId,
          class: req.classDoc._id,
        });

      if (!material) {
        return res.status(404).json({
          error: "Material not found.",
        });
      }

      // Remove the reference from the related Stream post, if any.
      await StreamPost.updateOne(
        {
          materialId: material._id,
        },
        {
          $set: {
            materialId: null,
          },
        }
      );

      res.json({
        message: "Material deleted successfully.",
        material,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          "Something went wrong while deleting the material.",
      });
    }
  }
);

// ---------- Learners & Progress ----------

// GET /api/classes/:classId/learners
router.get("/:classId/learners", async (req, res) => {
  try {
    const enrollments = await Enrollment.find({
      class: req.classDoc._id,
    })
      .populate(
        "learner",
        "displayName firstName secondName"
      )
      .sort({
        createdAt: 1,
      });

    res.json({
      learners: enrollments,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error:
        "Something went wrong while loading learners.",
    });
  }
});

// GET /api/classes/:classId/progress
router.get("/:classId/progress", async (req, res) => {
  try {
    const enrollments = await Enrollment.find({
      class: req.classDoc._id,
    })
      .populate(
        "learner",
        "displayName firstName secondName"
      )
      .sort({
        comprehensionAvg: -1,
      });

    res.json({
      progress: enrollments,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error:
        "Something went wrong while loading progress.",
    });
  }
});

// ── Learner router (read-only) ────────────────────────────────────────────────

const learnerRouter = express.Router();

learnerRouter.use(requireAuth, requireRole("learner"));

// Every /:classId/... route below requires an active class the learner is
// enrolled in. Attaches the class to req.classDoc.
learnerRouter.use("/:classId", async (req, res, next) => {
  try {
    const cls = await Class.findOne({
      _id: req.params.classId,
      status: "active",
    });

    if (!cls) {
      return res.status(404).json({ error: "Classroom not found." });
    }

    const enrolled = await Enrollment.findOne({
      class: cls._id,
      learner: req.userId,
    });

    if (!enrolled) {
      return res
        .status(403)
        .json({ error: "You're not enrolled in this classroom." });
    }

    req.classDoc = cls;
    next();
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Invalid class id." });
  }
});

// GET /api/learner/classes/:classId
learnerRouter.get("/:classId", async (req, res) => {
  try {
    const learnerCount = await Enrollment.countDocuments({
      class: req.classDoc._id,
    });

    res.json({ class: req.classDoc, learnerCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/learner/classes/:classId/stream
learnerRouter.get("/:classId/stream", async (req, res) => {
  try {
    const posts = await StreamPost.find({ class: req.classDoc._id })
      .populate("author", "displayName firstName secondName role")
      .sort({ createdAt: -1 });

    res.json({ posts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/learner/classes/:classId/classwork
// Only classwork assigned to everyone or to this learner. Correct answers
// are stripped so learners can't read them from the API response.
learnerRouter.get("/:classId/classwork", async (req, res) => {
  try {
    const items = await Classwork.find({
      class: req.classDoc._id,
      $or: [{ assignToAll: true }, { assignedTo: req.userId }],
    })
      .populate("material")
      .sort({ dueDate: 1, createdAt: -1 });

    const classwork = items.map((item) => {
      const obj = item.toObject();
      obj.questions = (obj.questions || []).map(
        ({ correctAnswer, ...question }) => question
      );
      return obj;
    });

    res.json({ classwork });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/learner/classes/:classId/materials
learnerRouter.get("/:classId/materials", async (req, res) => {
  try {
    const materials = await Material.find({ class: req.classDoc._id })
      .populate("uploadedBy", "displayName firstName secondName")
      .sort({ createdAt: -1 });

    res.json({ materials });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/learner/classes/:classId/learners
learnerRouter.get("/:classId/learners", async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ class: req.classDoc._id })
      .populate("learner", "displayName firstName secondName")
      .sort({ createdAt: 1 });

    res.json({ learners: enrollments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

module.exports = { teacherRouter: router, learnerRouter };