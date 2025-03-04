import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';

// Prevent potential memory leak warning
export const config = {
  api: {
    bodyParser: false,
  },
};

const prisma = new PrismaClient();

// Configure multer for file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), 'public/uploads'));
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

// Configure multer for multiple file fields
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
}).fields([
  { name: 'program_images', maxCount: 10 },
  { name: 'timeline_images', maxCount: 50 }
]);

// Helper function to remove uploaded files
const removeUploadedFiles = async (files: Express.Multer.File[]) => {
  for (const file of files) {
    try {
      await fs.unlink(file.path);
    } catch (error) {
      console.error('Error removing file:', error);
    }
  }
};

// Fetch all programs for admin
// Fetch corrections for timeline sorting and creation
export const fetchAllPrograms = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const programs = await prisma.trip.findMany({
      include: {
        timeline: {
          orderBy: { sortOrder: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json(programs);
  } catch (error) {
    console.error('Error fetching programs:', error);
    res.status(500).json({ message: 'Error fetching programs', error: (error as Error).message });
  }
};

// Fetch displayed programs
export const fetchDisplayedPrograms = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const programs = await prisma.trip.findMany({
      where: { display: true },
      include: {
        timeline: {
          orderBy: { sort_order: 'asc' }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    res.status(200).json(programs);
  } catch (error) {
    console.error('Error fetching programs:', error);
    res.status(500).json({ message: 'Error fetching programs', error: (error as Error).message });
  }
};

// Fetch program by ID
export const fetchProgramById = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const { id } = req.query;
    
    const program = await prisma.trip.findUnique({
      where: { id: id as string },
      include: {
        timeline: {
          orderBy: { sort_order: 'asc' }
        }
      }
    });

    if (!program) {
      return res.status(404).json({ message: 'Program not found' });
    }

    res.status(200).json(program);
  } catch (error) {
    console.error('Error fetching program by ID:', error);
    res.status(500).json({ message: 'Error fetching program by ID', error: (error as Error).message });
  }
};

// Create Program
export const createProgram = async (req: NextApiRequest, res: NextApiResponse) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error('Error uploading files:', err);
      return res.status(500).json({ message: 'Error uploading files', error: (err as Error).message });
    }

    try {
      const programData = JSON.parse(req.body.programData);
      const programImages = req.files['program_images'] || [];
      const timelineImages = req.files['timeline_images'] || [];

      // Validate dates
      const fromDate = new Date(programData.from_date);
      const toDate = new Date(programData.to_date);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ message: 'Invalid date format for from_date or to_date' });
      }

      // Save program images paths
      const imageUrls = programImages.map(file => file.filename);

      // Create program with timeline
      const program = await prisma.trip.create({
        data: {
          title: programData.title,
          metadata: programData.metadata || null,
          description: programData.description,
          images: imageUrls,
          location_from: programData.location_from,
          location_to: programData.location_to,
          days: programData.days,
          price: programData.price,
          from_date: fromDate,
          to_date: toDate,
          display: programData.display,
          timeline: {
            create: programData.timeline?.map((item, index) => ({
              title: item.title,
              description: item.description,
              image: timelineImages[index]?.filename || null,
              sortOrder: item.sortOrder,
              date: new Date(item.date)
            })) || []
          }
        },
        include: {
          timeline: true
        }
      });

      res.status(201).json({ 
        message: 'Program created successfully',
        programId: program.id
      });
    } catch (error) {
      // Clean up uploaded files if database operation fails
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      if (files) {
        const allFiles = [
          ...(files['program_images'] || []),
          ...(files['timeline_images'] || [])
        ];
        await removeUploadedFiles(allFiles);
      }
      console.error('Error creating program:', error);
      res.status(500).json({ message: 'Error creating program', error: (error as Error).message });
    }
  });
};

// Update Program
export const updateProgram = async (req: NextApiRequest, res: NextApiResponse) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error('Error uploading files:', err);
      return res.status(500).json({ message: 'Error uploading files', error: (err as Error).message });
    }

    try {
      const programData = JSON.parse(req.body.programData);
      const { id } = req.query;
      const programImages = req.files['program_images'] || [];
      const timelineImages = req.files['timeline_images'] || [];

      // Save program images paths
      const imageUrls = programImages.map(file => file.filename);

      // Update program with timeline
      const program = await prisma.trip.update({
        where: { id: id as string },
        data: {
          title: programData.title,
          metadata: programData.metadata || null,
          description: programData.description,
          images: imageUrls.length > 0 ? imageUrls : undefined,
          location_from: programData.location_from,
          location_to: programData.location_to,
          days: programData.days,
          price: programData.price,
          from_date: new Date(programData.from_date),
          to_date: new Date(programData.to_date),
          display: programData.display,
          timeline: {
            // Delete existing timeline and recreate
            deleteMany: {},
            create: programData.timeline?.map((item, index) => ({
              title: item.title,
              description: item.description,
              image: timelineImages[index]?.filename || null,
              sortOrder: item.sortOrder, // Corrected from sort_order to sortOrder
              date: new Date(item.date)
            })) || []
          }
        },
        include: {
          timeline: true
        }
      });

      res.status(200).json({ 
        message: 'Program updated successfully',
        programId: program.id
      });
    } catch (error) {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      if (files) {
        const allFiles = [
          ...(files['program_images'] || []),
          ...(files['timeline_images'] || [])
        ];
        await removeUploadedFiles(allFiles);
      }

      console.error('Error updating program:', error);
      res.status(500).json({ message: 'Error updating program', error: (error as Error).message });
    }
  });
};

// Delete Program
export const deleteProgram = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const { id } = req.query;

    const program = await prisma.trip.findUnique({
      where: { id: id as string },
    });

    if (program) {
      const images = program.images as string[];
      for (const imageUrl of images) {
        const imagePath = path.join(process.cwd(), 'public/uploads', imageUrl);
        try {
          await fs.unlink(imagePath);
        } catch (error) {
          console.warn(`Could not delete image ${imagePath}:`, error);
        }
      }

      await prisma.trip.delete({
        where: { id: id as string },
      });
    }

    res.status(200).json({ message: 'Program deleted successfully' });
  } catch (error) {
    console.error('Error deleting program:', error);
    res.status(500).json({ message: 'Error deleting program', error: (error as Error).message });
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  
  try {
    switch (req.method) {
      case 'POST':
        return createProgram(req, res);
      case 'PUT':
        return updateProgram(req, res);
      case 'DELETE':
        return deleteProgram(req, res);
      case 'GET':
        if (req.query.admin) return fetchAllPrograms(req, res);
        if (req.query.id) return fetchProgramById(req, res);
        return fetchDisplayedPrograms(req, res);
      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } finally {
    // Ensure Prisma client is disconnected after each request
    await prisma.$disconnect();
  }
}