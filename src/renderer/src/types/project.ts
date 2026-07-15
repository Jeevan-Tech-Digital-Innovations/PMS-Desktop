export interface Project {
  id: number;
  name: string;
  description: string;
  status: string;
  clientName: string;
  clientCompanyName: string;
  amount: number;
  createdAt: string;
  deadline: string;
  startDate: string;
  totalWorkingHours: number;
  totalTasks: number;
  completedTasks: number;
  projectManagerId: number;
  members: number[];
  billable: boolean;
  logoUrl: string;
}

export interface ProjectListResponse extends Array<Project> {}
