import React, { useState } from 'react';
import { useParams, useNavigate, Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, UserCheck, UserX, Trash, Calendar, Users, Music } from 'lucide-react';
import { coretrpc } from '@/lib/trpc';
import { formatDate, formatNumber } from '@/lib/utils';

export function UserDetailPage() {
  const { userId } = useParams({ from: '/_authenticated/users/$userId' });
  const navigate = useNavigate();
  const utils = coretrpc.useUtils();

  const { data: user, isLoading } = coretrpc.admin.users.getById.useQuery({ userId });
  const { data: attendances } = coretrpc.admin.users.getAttendances.useQuery({
    userId,
    page: 1,
    limit: 10
  });

  const suspendMutation = coretrpc.admin.users.suspend.useMutation({
    onSuccess: () => {
      utils.admin.users.getById.invalidate({ userId });
      utils.admin.users.list.invalidate();
    },
  });

  const unsuspendMutation = coretrpc.admin.users.unsuspend.useMutation({
    onSuccess: () => {
      utils.admin.users.getById.invalidate({ userId });
      utils.admin.users.list.invalidate();
    },
  });

  const deleteMutation = coretrpc.admin.users.delete.useMutation({
    onSuccess: () => {
      navigate({ to: '/users' });
    },
  });

  const handleSuspend = async () => {
    const reason = window.prompt('Reason for suspension (optional):');
    if (window.confirm('Are you sure you want to suspend this user?')) {
      await suspendMutation.mutateAsync({ userId, reason: reason || undefined });
    }
  };

  const handleUnsuspend = async () => {
    if (window.confirm('Are you sure you want to unsuspend this user?')) {
      await unsuspendMutation.mutateAsync({ userId });
    }
  };

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      await deleteMutation.mutateAsync({ userId });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-40 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">User not found</h2>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          The user you're looking for doesn't exist or has been deleted.
        </p>
        <Link to="/users">
          <Button className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Users
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex items-center space-x-4">
          <Link to="/users">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {user.displayName || 'Unknown User'}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              @{user.username} • {user.email}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {user.suspendedAt ? (
            <Button
              onClick={handleUnsuspend}
              disabled={unsuspendMutation.isPending}
              variant="outline"
            >
              <UserCheck className="h-4 w-4 mr-2" />
              Unsuspend User
            </Button>
          ) : (
            <Button
              onClick={handleSuspend}
              disabled={suspendMutation.isPending}
              variant="destructive"
            >
              <UserX className="h-4 w-4 mr-2" />
              Suspend User
            </Button>
          )}

          {!user.deletedAt && (
            <Button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              variant="destructive"
            >
              <Trash className="h-4 w-4 mr-2" />
              Delete User
            </Button>
          )}
        </div>
      </div>

      {/* User Status */}
      <div className="flex items-center space-x-2">
        <Badge
          variant={
            user.suspendedAt ? 'destructive' : user.deletedAt ? 'secondary' : 'default'
          }
          className="text-sm"
        >
          {user.suspendedAt ? 'Suspended' : user.deletedAt ? 'Deleted' : 'Active'}
        </Badge>
        {user.suspendedAt && user.suspendedReason && (
          <span className="text-sm text-gray-500">
            Reason: {user.suspendedReason}
          </span>
        )}
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Profile Info */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Profile Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <dt className="text-sm font-medium text-gray-500">Display Name</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {user.displayName || 'Not set'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Bio</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {user.bio || 'No bio'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Location</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {user.homeCity && user.homeCountry
                    ? `${user.homeCity}, ${user.homeCountry}`
                    : 'Not set'}
                </dd>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account Stats */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Account Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center">
                <Music className="h-4 w-4 text-gray-400 mr-2" />
                <div>
                  <p className="text-sm font-medium">Concerts Attended</p>
                  <p className="text-2xl font-bold">{formatNumber(user.attendanceCount)}</p>
                </div>
              </div>
              <div className="flex items-center">
                <Users className="h-4 w-4 text-gray-400 mr-2" />
                <div>
                  <p className="text-sm font-medium">Friends</p>
                  <p className="text-2xl font-bold">{formatNumber(user.friendCount)}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account Dates */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Account Dates</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <dt className="text-sm font-medium text-gray-500">Joined</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {formatDate(user.createdAt)}
                </dd>
              </div>
              {user.lastActiveAt && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Last Active</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {formatDate(user.lastActiveAt)}
                  </dd>
                </div>
              )}
              {user.suspendedAt && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Suspended</dt>
                  <dd className="mt-1 text-sm text-red-600">
                    {formatDate(user.suspendedAt)}
                  </dd>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Attendance */}
      {attendances?.items && attendances.items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Concert Attendance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {attendances.items.map((attendance) => (
                <div
                  key={attendance.id}
                  className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0"
                >
                  <div>
                    <p className="font-medium">Concert ID: {attendance.concertId}</p>
                    {attendance.notes && (
                      <p className="text-sm text-gray-500 mt-1">{attendance.notes}</p>
                    )}
                    {attendance.rating && (
                      <p className="text-sm text-yellow-600">
                        Rating: {attendance.rating}/5
                      </p>
                    )}
                  </div>
                  <span className="text-sm text-gray-500">
                    {formatDate(attendance.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Identity Providers */}
      {user.identities && user.identities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Connected Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {user.identities.map((identity) => (
                <div key={identity.id} className="flex justify-between items-center">
                  <div>
                    <p className="font-medium capitalize">{identity.provider}</p>
                    <p className="text-sm text-gray-500">{identity.email}</p>
                  </div>
                  <span className="text-sm text-gray-500">
                    Connected {formatDate(identity.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}