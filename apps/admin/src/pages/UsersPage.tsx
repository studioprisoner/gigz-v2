import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatNumber } from '@/lib/utils';
import { Search, UserCheck, UserX, Eye } from 'lucide-react';
import { coretrpc } from '@/lib/trpc';
import { Link } from '@tanstack/react-router';

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'suspended' | 'deleted' | undefined>();
  const [page, setPage] = useState(1);
  const limit = 50;
  const utils = coretrpc.useUtils();

  const { data: users, isLoading, refetch } = coretrpc.admin.users.list.useQuery({
    search: search || undefined,
    status,
    page,
    limit,
    sortBy: 'createdAt',
    sortOrder: 'desc'
  });

  const suspendMutation = coretrpc.admin.users.suspend.useMutation({
    onSuccess: () => {
      utils.admin.users.list.invalidate();
    },
  });

  const unsuspendMutation = coretrpc.admin.users.unsuspend.useMutation({
    onSuccess: () => {
      utils.admin.users.list.invalidate();
    },
  });

  const handleSuspend = async (userId: string) => {
    const reason = window.prompt('Reason for suspension (optional):');
    if (window.confirm('Are you sure you want to suspend this user?')) {
      await suspendMutation.mutateAsync({ userId, reason: reason || undefined });
    }
  };

  const handleUnsuspend = async (userId: string) => {
    await unsuspendMutation.mutateAsync({ userId });
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1); // Reset to first page on search
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">User Management</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Manage user accounts and monitor user activity
        </p>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Search Users</CardTitle>
          <CardDescription>Search by name, email, or user ID</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search users..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <select
              className="px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-800 dark:border-gray-600"
              value={status || 'all'}
              onChange={(e) => {
                setStatus(e.target.value === 'all' ? undefined : e.target.value as 'active' | 'suspended' | 'deleted');
                setPage(1);
              }}
            >
              <option value="all">All Users</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deleted">Deleted</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {users?.total ? `${formatNumber(users.total)} total users` : 'Loading...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : users?.items?.length ? (
            <div className="space-y-4">
              {users.items.map((user) => (
                <div
                  key={user.id}
                  className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="flex-shrink-0">
                        <div className="h-10 w-10 bg-gray-300 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-gray-700">
                            {user.displayName?.charAt(0) || user.username?.charAt(0) || 'U'}
                          </span>
                        </div>
                      </div>
                      <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                          {user.displayName || 'Unknown User'}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          @{user.username} • {user.email}
                        </p>
                        <div className="flex items-center space-x-4 mt-1">
                          <span className="text-xs text-gray-500">
                            Joined: {formatDate(user.createdAt)}
                          </span>
                          {user.lastActiveAt && (
                            <span className="text-xs text-gray-500">
                              Last active: {formatDate(user.lastActiveAt)}
                            </span>
                          )}
                          <span className="text-xs text-gray-500">
                            {formatNumber(user.totalShowsCount || 0)} concerts
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Badge
                        variant={
                          user.suspendedAt
                            ? 'destructive'
                            : user.deletedAt
                            ? 'secondary'
                            : 'default'
                        }
                      >
                        {user.suspendedAt
                          ? 'Suspended'
                          : user.deletedAt
                          ? 'Deleted'
                          : 'Active'}
                      </Badge>

                      <Link to="/users/$userId" params={{ userId: user.id }}>
                        <Button variant="outline" size="sm">
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      </Link>

                      {user.suspendedAt ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUnsuspend(user.id)}
                          disabled={unsuspendMutation.isPending}
                        >
                          <UserCheck className="h-4 w-4 mr-1" />
                          Unsuspend
                        </Button>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleSuspend(user.id)}
                          disabled={suspendMutation.isPending}
                        >
                          <UserX className="h-4 w-4 mr-1" />
                          Suspend
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Pagination */}
              {users.total > limit && (
                <div className="flex items-center justify-between mt-6">
                  <div className="text-sm text-gray-500">
                    Showing {(page - 1) * limit + 1} to{' '}
                    {Math.min(page * limit, users.total)} of {formatNumber(users.total)} users
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      disabled={page * limit >= users.total}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">
              No users found
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}