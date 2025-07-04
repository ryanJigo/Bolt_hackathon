import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { Share, Check, ArrowLeft } from "lucide-react";
import { useSupabaseClient } from "../services/supabase";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import { ProjectHeader } from "../components/common/ProjectHeader";
import { ProjectRoadmap } from "../components/common/ProjectRoadmap";
import { ProjectDocuments } from "../components/common/ProjectDocuments";
import { PropertiesOfInterest } from "../components/common/PropertiesOfInterest";
import { RecentUpdates } from "../components/common/RecentUpdates";
import { ClientTourAvailabilityCard } from "../components/common/ClientTourAvailabilityCard";
import { DragDropList } from "../components/common/DragDropList";
import type { Database } from "../types/database";
import { usePersistentState } from "../hooks/usePersistentState";
import { ProjectCard } from "../types/project";
import {
  migrateDashboardCardOrder,
  saveDashboardCardOrder,
} from "../utils/dashboardCards";

type ProjectData = Database["public"]["Tables"]["projects"]["Row"];

const DEFAULT_CARD_ORDER: ProjectCard[] = [
  { id: "updates", type: "updates", title: "Recent Updates", order_key: "a0" },
  {
    id: "availability",
    type: "availability",
    title: "Client Tour Availability",
    order_key: "a1",
  },
  {
    id: "properties",
    type: "properties",
    title: "Properties of Interest",
    order_key: "a2",
  },
  { id: "roadmap", type: "roadmap", title: "Project Roadmap", order_key: "a3" },
  {
    id: "documents",
    type: "documents",
    title: "Project Documents",
    order_key: "a4",
  },
];

export function LeaseTrackerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isLoaded } = useUser();
  const supabase = useSupabaseClient();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [cardOrder, setCardOrder] = usePersistentState<ProjectCard[]>(
    `project-card-order-${id}`,
    DEFAULT_CARD_ORDER,
  );

  const fetchProject = useCallback(async () => {
    if (!id) return;

    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .single();

      if (error) {
        setError("Failed to load project");
        return;
      }

      setProject(data);

      // Load and migrate dashboard card order from database if available
      const migratedCardOrder = migrateDashboardCardOrder(
        data.dashboard_card_order,
        DEFAULT_CARD_ORDER,
      );
      setCardOrder(migratedCardOrder);

      // Save migrated data back to database if it was migrated
      if (data.dashboard_card_order) {
        // Compare by checking if the raw data doesn't have order_key
        const needsMigration = Array.isArray(data.dashboard_card_order)
          ? !data.dashboard_card_order.every(
              (card: unknown) =>
                typeof card === "object" &&
                card !== null &&
                "order_key" in (card as Record<string, unknown>),
            )
          : true;

        if (needsMigration) {
          saveDashboardCardOrder(migratedCardOrder, data.id, supabase);
        }
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }, [id, supabase, setCardOrder]);

  const handleCardReorder = useCallback(
    async (oldIndex: number, newIndex: number) => {
      const newOrder = [...cardOrder];
      const [removed] = newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, removed);

      // Generate simple sequential order keys
      const updatedOrder = newOrder.map((card, index) => ({
        ...card,
        order_key: `a${index}`,
      }));

      // Update UI immediately (localStorage persistence handled by hook)
      setCardOrder(updatedOrder);

      // Save to database in background
      if (project?.id) {
        await saveDashboardCardOrder(updatedOrder, project.id, supabase);
      }
    },
    [cardOrder, setCardOrder, supabase, project?.id],
  );

  const copyToClipboard = async (text: string): Promise<boolean> => {
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fallback to execCommand
      }
    }

    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const success = document.execCommand("copy");
      document.body.removeChild(textArea);

      return success;
    } catch {
      return false;
    }
  };

  const handleShareProject = async () => {
    if (!project || !user) return;

    try {
      let shareId = project.public_share_id;
      let publicUrl: string;

      if (shareId) {
        publicUrl = `${window.location.origin}/share/${shareId}`;
        const success = await copyToClipboard(publicUrl);

        if (success) {
          setCopySuccess(true);
          setTimeout(() => setCopySuccess(false), 2000);
        } else {
          alert("Failed to copy link to clipboard. Please try again.");
        }
        return;
      }

      shareId = crypto.randomUUID();
      publicUrl = `${window.location.origin}/share/${shareId}`;

      const success = await copyToClipboard(publicUrl);
      if (!success) {
        alert("Failed to copy link to clipboard. Please try again.");
        return;
      }

      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);

      try {
        const { error } = await supabase
          .from("projects")
          .update({ public_share_id: shareId })
          .eq("id", project.id);

        if (!error) {
          setProject({ ...project, public_share_id: shareId });
        }
      } catch {
        // Link still works since we copied it first
      }
    } catch {
      alert("Failed to create share link. Please try again.");
    }
  };

  const renderCard = useCallback(
    (card: ProjectCard) => {
      if (!project) return null;

      switch (card.type) {
        case "updates":
          return <RecentUpdates key={card.id} projectId={project.id} />;
        case "availability":
          return (
            <ClientTourAvailabilityCard key={card.id} projectId={project.id} />
          );
        case "properties":
          return <PropertiesOfInterest key={card.id} projectId={project.id} />;
        case "roadmap":
          return <ProjectRoadmap key={card.id} projectId={project.id} />;
        case "documents":
          return <ProjectDocuments key={card.id} projectId={project.id} />;
        default:
          return null;
      }
    },
    [project],
  );

  useEffect(() => {
    if (isLoaded && user && id) {
      fetchProject();
    } else if (isLoaded && !user) {
      navigate("/");
    }
  }, [isLoaded, user, id, navigate, fetchProject]);

  if (!isLoaded || loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !project) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            Project not found
          </h2>
          <p className="text-slate-600 mb-6">
            {error ||
              "The project you're looking for doesn't exist or you don't have permission to view it."}
          </p>
          <button
            onClick={() => navigate("/projects")}
            className="btn-primary flex items-center space-x-2 mx-auto"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Projects</span>
          </button>
        </div>
      </DashboardLayout>
    );
  }

  const headerContent = (
    <div className="flex items-center space-x-4">
      <button
        onClick={() => navigate("/projects")}
        className="btn-secondary flex items-center space-x-2"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Projects</span>
      </button>
      <button
        onClick={handleShareProject}
        className="btn-secondary flex items-center space-x-2"
      >
        {copySuccess ? (
          <>
            <Check className="w-4 h-4 text-green-600" />
            <span className="text-green-600">Copied!</span>
          </>
        ) : (
          <>
            <Share className="w-4 h-4" />
            <span>Share Project</span>
          </>
        )}
      </button>
    </div>
  );

  return (
    <DashboardLayout headerContent={headerContent}>
      <div className="space-y-6">
        {/* Project Header - Always at top */}
        <ProjectHeader project={project} onProjectUpdate={fetchProject} />

        {/* Draggable Cards Section */}
        <div className="bg-gray-50 rounded-xl p-4">
          <DragDropList
            items={cardOrder}
            onReorder={handleCardReorder}
            showHandle={true}
            disabled={false}
          >
            {(card) => (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                {renderCard(card)}
              </div>
            )}
          </DragDropList>
        </div>
      </div>
    </DashboardLayout>
  );
}
